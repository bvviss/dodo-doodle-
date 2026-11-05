// GameRoom: the referee for one room.
//
// Plain TypeScript with NO Cloudflare imports. Time, timers, randomness and ids
// come from an injected `deps` object, and players are reached through the
// `Connection` interface. That lets tests run whole games instantly with a
// fake clock (see tests/room.test.ts). The Durable Object in worker/index.ts
// just creates one GameRoom and forwards WebSocket messages to it.
//
// A room can also be saved (toSnapshot) and loaded back (fromSnapshot). The
// Vercel version (api/) does that on every request and uses "poll" presence:
// players count as online while they keep checking in.

import {
  GRACE_MS,
  LIMITS,
  MODIFIER_BANNER_MS,
  PALETTE,
  PEN_SIZES,
  PLAYER_COLOURS,
  REACTIONS,
  REACTION_COOLDOWN_MS,
  REROLLS_PER_GAME,
  CANVAS_H,
  CANVAS_W,
  type ActiveModifier,
  type ClientMsg,
  type ErrorCode,
  type Phase,
  type Point,
  type PublicPlayer,
  type PublicRoom,
  type RevealMatch,
  type ScoreLine,
  type ServerMsg,
  type Settings,
  type Step,
  type Stroke,
  type Task,
  type TurnKind,
} from "../shared/types";
import {
  DEFAULT_SETTINGS,
  chainForSeat,
  chainLength,
  finalMatch,
  matchGuess,
  pickModifier,
  sanitizeCustomWords,
  sanitizeName,
  sanitizeSettings,
  sanitizeStrokes,
  sanitizeText,
  scoreGame,
  shuffle,
  targetPhrase,
  turnKind,
  voteThreshold,
} from "../shared/rules";
import { fallbackWords, wordsFor } from "../shared/words";

// ---------------------------------------------------------------- interfaces

export interface Connection {
  send(msg: ServerMsg): void;
  close(): void;
}

export type TimerHandle = unknown;

export interface RoomDeps {
  now(): number;
  setTimer(fn: () => void, ms: number): TimerHandle;
  clearTimer(handle: TimerHandle): void;
  random(): number;
  makeId(): string;
}

// ---------------------------------------------------------------- internals

interface Player {
  id: string;
  token: string;
  name: string;
  colour: string;
  isBot: boolean;
  conn: Connection | null;
  score: number;
  rerollsLeft: number;
  lastReaction: number;
  taskSeq: number;
  sentTaskSeq: number;
  /** Online right now (socket open, or checked in recently in poll mode). */
  online: boolean;
  /** Last check-in time (poll mode). */
  lastSeen: number;
}

/** Timers are plain data so a room can be saved and loaded. */
type NamedTimer =
  | { id: number; at: number; kind: "endTurn"; turn: number }
  | { id: number; at: number; kind: "bot"; pid: string; turn: number }
  | { id: number; at: number; kind: "leave"; pid: string }
  | { id: number; at: number; kind: "abandon" };
type TimerSpec = NamedTimer extends infer T ? (T extends NamedTimer ? Omit<T, "id"> : never) : never;

export type Presence = "socket" | "poll";

/** A saved room: plain JSON. */
export interface RoomSnapshot {
  v: 1;
  players: Omit<Player, "conn">[];
  hostId: string | null;
  phase: Phase;
  settings: Settings;
  customWords: string[];
  seats: string[];
  totalTurns: number;
  turn: number;
  deadline: number | null;
  chains: Step[][];
  ts: {
    kind: TurnKind;
    tasks: [string, Task][];
    chainOf: [string, number][];
    submissions: [string, string | Stroke[]][];
    autosaves: [string, Stroke[]][];
    dealt: [string, string][];
  } | null;
  modifier: ActiveModifier | null;
  builtinDeck: string[];
  customDeck: string[];
  reveal: { chain: number; step: number } | null;
  scores: ScoreLine[] | null;
  timers: NamedTimer[];
  timerSeq: number;
  reactions: RecentReaction[];
  reactionSeq: number;
}

/**
 * The Vercel version stores drawings separately and loads a room with
 * placeholder arrays (empty, with a `$ref` key). This spots them.
 */
export function isStrokeRef(a: unknown): boolean {
  return Array.isArray(a) && typeof (a as unknown as { $ref?: unknown }).$ref === "string";
}

export interface RecentReaction {
  id: number;
  emoji: string;
  playerId: string;
  at: number;
}

interface TurnState {
  kind: TurnKind;
  tasks: Map<string, Task>;
  chainOf: Map<string, number>;
  submissions: Map<string, string | Stroke[]>;
  autosaves: Map<string, Stroke[]>;
  dealt: Map<string, string>;
}

const BOT_NAMES = [
  "Bot Bella", "Bot Boris", "Bot Coco", "Bot Dino", "Bot Echo",
  "Bot Fizz", "Bot Gizmo", "Bot Hoot", "Bot Iggy", "Bot Juno",
];

/** Lobby players who disconnect are removed after this long. */
export const LOBBY_LEAVE_MS = 90_000;
/** A room with no connected humans resets after this long. */
export const ABANDON_MS = 10 * 60_000;
/** Poll mode: a player who hasn't checked in for this long counts as gone. */
export const PRESENCE_MS = 12_000;
/** Poll mode: reactions are kept this long so everyone's next check-in sees them. */
export const REACTION_KEEP_MS = 8_000;
export const BOT_MIN_DELAY_MS = 1200;
export const BOT_MAX_DELAY_MS = 3700;

// ---------------------------------------------------------------- room

export class GameRoom {
  readonly code: string;
  private deps: RoomDeps;

  private players: Player[] = [];
  private conns = new Map<Connection, string | null>();
  private hostId: string | null = null;

  private phase: Phase = "lobby";
  private settings: Settings = { ...DEFAULT_SETTINGS, packs: [...DEFAULT_SETTINGS.packs] };
  private customWords: string[] = [];

  // game
  private seats: string[] = [];
  private totalTurns = 0;
  private turn = 0;
  private deadline: number | null = null;
  private chains: Step[][] = [];
  private ts: TurnState | null = null;
  private modifier: ActiveModifier | null = null;
  private builtinDeck: string[] = [];
  private customDeck: string[] = [];

  // reveal + scores
  private reveal: { chain: number; step: number } | null = null;
  private scores: ScoreLine[] | null = null;

  private timers: NamedTimer[] = [];
  private timerSeq = 0;
  private wake: TimerHandle | null = null;
  private reactions: RecentReaction[] = [];
  private reactionSeq = 0;
  readonly presence: Presence;

  constructor(code: string, deps: RoomDeps, presence: Presence = "socket") {
    this.code = code;
    this.deps = deps;
    this.presence = presence;
  }

  // ============================================================ timers

  private schedule(spec: TimerSpec): void {
    this.timers.push({ ...spec, id: ++this.timerSeq } as NamedTimer);
    this.armWake();
  }

  private cancelTimers(match: (t: NamedTimer) => boolean): void {
    const before = this.timers.length;
    this.timers = this.timers.filter((t) => !match(t));
    if (this.timers.length !== before) this.armWake();
  }

  /** Socket mode: one real timer, set for the earliest named timer. */
  private armWake(): void {
    if (this.wake !== null) this.deps.clearTimer(this.wake);
    this.wake = null;
    const next = this.nextDue();
    if (next === null) return;
    this.wake = this.deps.setTimer(() => {
      this.wake = null;
      this.runDue();
    }, next - this.deps.now());
  }

  /** When the next timer is due (server time), or null. */
  nextDue(): number | null {
    let at: number | null = null;
    for (const t of this.timers) if (at === null || t.at < at) at = t.at;
    return at;
  }

  /** Run every timer that is due, in time order. */
  runDue(): void {
    for (let guard = 0; guard < 1000; guard++) {
      const now = this.deps.now();
      let next: NamedTimer | null = null;
      for (const t of this.timers) if (t.at <= now && (!next || t.at < next.at || (t.at === next.at && t.id < next.id))) next = t;
      if (!next) break;
      const fired = next;
      this.timers = this.timers.filter((t) => t !== fired);
      this.fire(fired);
    }
    this.armWake();
  }

  private fire(t: NamedTimer): void {
    switch (t.kind) {
      case "endTurn":
        if (this.isTurnPhase() && this.turn === t.turn) this.endTurn();
        return;
      case "bot": {
        const p = this.player(t.pid);
        if (p && this.isTurnPhase() && this.turn === t.turn) this.botSubmit(p);
        return;
      }
      case "leave": {
        const p = this.player(t.pid);
        if (p && this.phase === "lobby" && !p.online) {
          this.removePlayer(p.id);
          this.broadcast();
        }
        return;
      }
      case "abandon":
        this.resetRoom();
        return;
    }
  }

  // ============================================================ connection API

  connect(conn: Connection): void {
    this.conns.set(conn, null);
  }

  disconnect(conn: Connection): void {
    const pid = this.conns.get(conn);
    this.conns.delete(conn);
    if (!pid) return;
    const p = this.player(pid);
    if (!p || p.conn !== conn) return;
    p.conn = null;
    if (this.presence === "poll") return; // poll mode: presence comes from check-ins
    p.online = false;
    this.onPlayerLeft(p);
  }

  /** Handle a raw message (JSON string or already-parsed object). */
  message(conn: Connection, raw: unknown): void {
    let msg: unknown = raw;
    if (typeof raw === "string") {
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
    }
    if (!msg || typeof msg !== "object" || typeof (msg as { type?: unknown }).type !== "string") return;
    this.handle(conn, msg as ClientMsg);
  }

  /** Number of connected humans (used by the Durable Object for /info). */
  get playerCount(): number {
    return this.players.length;
  }

  // ============================================================ dispatch

  private handle(conn: Connection, msg: ClientMsg): void {
    if (msg.type === "ping") {
      if (typeof msg.t === "number") conn.send({ type: "pong", t: msg.t, serverNow: this.deps.now() });
      return;
    }
    if (msg.type === "join") return this.onJoin(conn, msg);

    const pid = this.conns.get(conn);
    const p = pid ? this.player(pid) : undefined;
    if (!p) return;
    const isHost = p.id === this.hostId;

    switch (msg.type) {
      case "settings":
        if (isHost && this.phase === "lobby") this.onSettings(msg);
        return;
      case "start":
        if (isHost && this.phase === "lobby") this.onStart(p);
        return;
      case "kick":
        if (isHost && this.phase === "lobby") this.onKick(p, msg.playerId);
        return;
      case "addBot":
        if (isHost && this.phase === "lobby") this.onAddBot(p);
        return;
      case "removeBot":
        if (isHost && this.phase === "lobby") this.onRemoveBot();
        return;
      case "reroll":
        return this.onReroll(p);
      case "submit":
        return this.onSubmit(p, msg);
      case "autosave":
        return this.onAutosave(p, msg.strokes);
      case "revealNext":
        if (isHost && this.phase === "reveal") this.onRevealNext();
        return;
      case "react":
        return this.onReact(p, msg.emoji);
      case "vote":
        return this.onVote(p, msg.chain, msg.step);
      case "getChain":
        return this.onGetChain(p, msg.chain);
      case "playAgain":
        if (isHost && this.phase === "scores") this.onPlayAgain();
        return;
    }
  }

  // ============================================================ lobby

  private onJoin(conn: Connection, msg: Extract<ClientMsg, { type: "join" }>): void {
    if (this.conns.get(conn)) return; // already joined on this connection

    const existing = typeof msg.token === "string" ? this.players.find((p) => p.token === msg.token && !p.isBot) : undefined;
    if (existing) {
      if (existing.conn && existing.conn !== conn) {
        const old = existing.conn;
        this.conns.delete(old);
        old.close();
      }
      existing.conn = conn;
      this.conns.set(conn, existing.id);
      existing.lastSeen = this.deps.now();
      conn.send({ type: "welcome", playerId: existing.id, token: existing.token });
      this.markOnline(existing);
      this.broadcast(existing.id);
      this.sendCurrentReveal(existing);
      return;
    }

    if (this.phase !== "lobby") {
      return this.error(conn, "This game is already in progress. Ask the host to start a new room, or wait for them to press Play again.", "in_progress");
    }
    if (this.players.length >= LIMITS.maxPlayers) {
      return this.error(conn, `This room is full (${LIMITS.maxPlayers} players max).`, "full");
    }

    const p: Player = {
      id: this.deps.makeId(),
      token: this.deps.makeId() + this.deps.makeId(),
      name: sanitizeName(msg.name, this.players.map((x) => x.name)),
      colour: this.pickColour(msg.colour),
      isBot: false,
      conn,
      score: 0,
      rerollsLeft: REROLLS_PER_GAME,
      lastReaction: 0,
      taskSeq: 0,
      sentTaskSeq: -1,
      online: true,
      lastSeen: this.deps.now(),
    };
    this.players.push(p);
    this.conns.set(conn, p.id);
    this.cancelAbandon();
    conn.send({ type: "welcome", playerId: p.id, token: p.token });
    this.ensureHost();
    this.broadcast();
  }

  private pickColour(wanted: unknown): string {
    if (typeof wanted === "string" && (PLAYER_COLOURS as readonly string[]).includes(wanted)) return wanted;
    const used = new Set(this.players.map((p) => p.colour));
    return PLAYER_COLOURS.find((c) => !used.has(c)) ?? PLAYER_COLOURS[Math.floor(this.deps.random() * PLAYER_COLOURS.length)];
  }

  private onSettings(msg: Extract<ClientMsg, { type: "settings" }>): void {
    this.settings = sanitizeSettings(msg.settings, this.settings);
    if (msg.customWords !== undefined) this.customWords = sanitizeCustomWords(msg.customWords);
    this.broadcast();
  }

  private onAddBot(host: Player): void {
    if (this.players.length >= LIMITS.maxPlayers) {
      return this.errorTo(host, `The room is full (${LIMITS.maxPlayers} players max).`, "full");
    }
    const taken = new Set(this.players.map((p) => p.name));
    const name = BOT_NAMES.find((n) => !taken.has(n)) ?? sanitizeName("Bot", [...taken]);
    const used = new Set(this.players.map((p) => p.colour));
    const free = PLAYER_COLOURS.filter((c) => !used.has(c));
    const pool = free.length ? free : [...PLAYER_COLOURS];
    this.players.push({
      id: this.deps.makeId(),
      token: "",
      name,
      colour: pool[Math.floor(this.deps.random() * pool.length) % pool.length],
      isBot: true,
      conn: null,
      score: 0,
      rerollsLeft: REROLLS_PER_GAME,
      lastReaction: 0,
      taskSeq: 0,
      sentTaskSeq: -1,
      online: true,
      lastSeen: 0,
    });
    this.broadcast();
  }

  private onRemoveBot(): void {
    for (let i = this.players.length - 1; i >= 0; i--) {
      if (this.players[i].isBot) {
        this.players.splice(i, 1);
        break;
      }
    }
    this.broadcast();
  }

  private onKick(host: Player, targetId: unknown): void {
    const target = typeof targetId === "string" ? this.player(targetId) : undefined;
    if (!target || target.id === host.id) return;
    target.online = false;
    if (target.conn) {
      const c = target.conn;
      this.conns.delete(c);
      target.conn = null;
      c.send({ type: "error", message: "The host removed you from the room.", code: "kicked" });
      c.close();
    }
    this.removePlayer(target.id);
    this.broadcast();
  }

  private onStart(host: Player): void {
    // Drop anyone who left the lobby.
    for (const p of [...this.players]) if (!p.isBot && !p.online) this.removePlayer(p.id);

    if (this.players.length < LIMITS.minPlayers) {
      return this.errorTo(host, `You need at least ${LIMITS.minPlayers} players to start. Add some bots!`, "not_allowed");
    }
    if (this.settings.promptSource === "custom" && this.customWords.length === 0) {
      return this.errorTo(host, "Your custom word list is empty. Add some words first (one per line).", "not_allowed");
    }

    this.seats = shuffle(
      this.players.map((p) => p.id),
      this.deps.random,
    );
    this.totalTurns = chainLength(this.seats.length, this.settings.chainLength);
    this.chains = this.seats.map(() => []);
    this.turn = 0;
    this.reveal = null;
    this.scores = null;
    for (const p of this.players) {
      p.score = 0;
      p.rerollsLeft = REROLLS_PER_GAME;
    }
    this.builtinDeck = [];
    this.customDeck = [];
    this.beginTurn();
  }

  private removePlayer(id: string): void {
    const i = this.players.findIndex((p) => p.id === id);
    if (i < 0) return;
    this.players.splice(i, 1);
    this.cancelTimers((t) => t.kind === "leave" && t.pid === id);
    if (this.hostId === id) {
      this.hostId = null;
      this.ensureHost();
    }
  }

  /** Host = first player. If the host is gone, pass to the next connected human. */
  private ensureHost(): void {
    const host = this.hostId ? this.player(this.hostId) : undefined;
    if (host && !host.isBot && host.online) return;
    const next = this.players.find((p) => !p.isBot && p.online);
    if (next) this.hostId = next.id;
    else if (!host) this.hostId = this.players.find((p) => !p.isBot)?.id ?? null;
  }

  private onPlayerLeft(p: Player): void {
    this.ensureHost();
    const now = this.deps.now();
    if (this.phase === "lobby") {
      this.cancelTimers((t) => t.kind === "leave" && t.pid === p.id);
      this.schedule({ kind: "leave", at: now + LOBBY_LEAVE_MS, pid: p.id });
    }
    if (!this.players.some((x) => !x.isBot && x.online)) {
      this.cancelAbandon();
      this.schedule({ kind: "abandon", at: now + ABANDON_MS });
    }
    if (this.isTurnPhase() && this.checkTurnComplete()) return;
    this.broadcast();
  }

  /** A player is (back) online: cancel their removal and make sure there's a host. */
  private markOnline(p: Player): void {
    p.online = true;
    this.cancelTimers((t) => t.kind === "leave" && t.pid === p.id);
    this.cancelAbandon();
    this.ensureHost();
  }

  private cancelAbandon(): void {
    this.cancelTimers((t) => t.kind === "abandon");
  }

  /** Everyone left long ago: start fresh so the code can be reused. */
  private resetRoom(): void {
    if (this.players.some((p) => !p.isBot && p.online)) return;
    this.timers = [];
    this.armWake();
    this.players = [];
    this.hostId = null;
    this.phase = "lobby";
    this.settings = { ...DEFAULT_SETTINGS, packs: [...DEFAULT_SETTINGS.packs] };
    this.customWords = [];
    this.seats = [];
    this.chains = [];
    this.ts = null;
    this.turn = 0;
    this.totalTurns = 0;
    this.deadline = null;
    this.modifier = null;
    this.reveal = null;
    this.scores = null;
  }

  // ============================================================ turns

  private isTurnPhase(): boolean {
    return this.phase === "prompt" || this.phase === "draw" || this.phase === "guess";
  }

  private beginTurn(): void {
    const kind = turnKind(this.turn);
    const now = this.deps.now();
    const n = this.seats.length;
    this.phase = kind;
    this.modifier = kind === "draw" ? pickModifier(this.settings.modifiers, this.deps.random) : null;
    const seconds =
      kind === "prompt"
        ? this.settings.promptTime
        : kind === "draw"
          ? (this.modifier?.drawTime ?? this.settings.drawTime)
          : this.settings.guessTime;
    const startsAt = now + (this.modifier ? MODIFIER_BANNER_MS : 0);
    this.deadline = startsAt + seconds * 1000;

    const ts: TurnState = {
      kind,
      tasks: new Map(),
      chainOf: new Map(),
      submissions: new Map(),
      autosaves: new Map(),
      dealt: new Map(),
    };
    this.ts = ts;

    this.seats.forEach((pid, seat) => {
      const c = chainForSeat(seat, this.turn, n);
      ts.chainOf.set(pid, c);
      const p = this.player(pid)!;
      let task: Task;
      if (kind === "prompt") {
        const dealt = this.settings.promptSource === "player" ? null : this.dealWord();
        if (dealt) ts.dealt.set(pid, dealt);
        task = { kind: "prompt", dealt, rerollsLeft: dealt ? p.rerollsLeft : 0 };
      } else if (kind === "draw") {
        const prev = this.chains[c][this.turn - 1];
        task = { kind: "draw", phrase: prev && prev.kind !== "drawing" ? prev.text : "???", modifier: this.modifier, startsAt };
      } else {
        const prev = this.chains[c][this.turn - 1];
        task = { kind: "guess", strokes: prev && prev.kind === "drawing" ? prev.strokes : [] };
      }
      ts.tasks.set(pid, task);
      p.taskSeq++;
    });

    this.schedule({ kind: "endTurn", at: this.deadline + GRACE_MS, turn: this.turn });

    for (const pid of this.seats) {
      const p = this.player(pid)!;
      if (!p.isBot) continue;
      const delay = startsAt - now + BOT_MIN_DELAY_MS + this.deps.random() * (BOT_MAX_DELAY_MS - BOT_MIN_DELAY_MS);
      this.schedule({ kind: "bot", at: now + delay, pid, turn: this.turn });
    }
    this.broadcast();
  }

  private dealWord(): string {
    const fromCustom =
      this.settings.promptSource === "custom" ||
      (this.settings.promptSource === "mix" && this.customWords.length > 0 && this.deps.random() < 0.5);
    if (fromCustom && this.customWords.length > 0) {
      if (!this.customDeck.length) this.customDeck = shuffle(this.customWords, this.deps.random);
      return this.customDeck.pop()!;
    }
    if (!this.builtinDeck.length) {
      const words = wordsFor(this.settings.packs, this.settings.difficulty);
      this.builtinDeck = shuffle(words.length ? words : fallbackWords(), this.deps.random);
    }
    return this.builtinDeck.pop()!;
  }

  private randomWord(): string {
    const words = fallbackWords();
    return words[Math.floor(this.deps.random() * words.length) % words.length];
  }

  private onReroll(p: Player): void {
    const ts = this.ts;
    if (this.phase !== "prompt" || !ts) return;
    const task = ts.tasks.get(p.id);
    if (!task || task.kind !== "prompt" || !task.dealt || ts.submissions.has(p.id)) return;
    if (p.rerollsLeft <= 0) return this.errorTo(p, "No re-rolls left this game.", "not_allowed");
    let word = this.dealWord();
    if (word === task.dealt) word = this.dealWord();
    p.rerollsLeft--;
    ts.dealt.set(p.id, word);
    ts.tasks.set(p.id, { kind: "prompt", dealt: word, rerollsLeft: p.rerollsLeft });
    p.taskSeq++;
    this.sendState(p);
  }

  private onSubmit(p: Player, msg: Extract<ClientMsg, { type: "submit" }>): void {
    const ts = this.ts;
    if (!this.isTurnPhase() || !ts || !ts.tasks.has(p.id) || ts.submissions.has(p.id)) return;
    if (ts.kind === "draw") {
      this.acceptSubmission(p.id, sanitizeStrokes(msg.strokes));
    } else if (ts.kind === "prompt" && ts.dealt.has(p.id)) {
      this.acceptSubmission(p.id, ts.dealt.get(p.id)!);
    } else {
      this.acceptSubmission(p.id, sanitizeText(msg.text));
    }
  }

  private onAutosave(p: Player, strokes: unknown): void {
    const ts = this.ts;
    if (this.phase !== "draw" || !ts || !ts.tasks.has(p.id) || ts.submissions.has(p.id)) return;
    ts.autosaves.set(p.id, sanitizeStrokes(strokes));
  }

  private botSubmit(p: Player): void {
    const ts = this.ts;
    if (!ts || ts.submissions.has(p.id)) return;
    const task = ts.tasks.get(p.id);
    if (!task) return;
    if (task.kind === "prompt") {
      this.acceptSubmission(p.id, task.dealt ?? this.randomWord());
    } else if (task.kind === "draw") {
      this.acceptSubmission(p.id, botDrawing(this.deps.random));
    } else {
      const c = ts.chainOf.get(p.id)!;
      const target = targetPhrase(this.chains[c], this.turn);
      this.acceptSubmission(p.id, this.deps.random() < 0.5 && target ? target : this.randomWord());
    }
  }

  private acceptSubmission(pid: string, value: string | Stroke[]): void {
    this.ts?.submissions.set(pid, value);
    if (!this.checkTurnComplete()) this.broadcast();
  }

  /** Ends the turn if everyone connected has submitted. Returns true if it ended. */
  private checkTurnComplete(): boolean {
    const ts = this.ts;
    if (!ts || !this.isTurnPhase()) return false;
    const anyHuman = this.seats.some((id) => {
      const p = this.player(id);
      return p && !p.isBot && p.online;
    });
    // With nobody connected, keep waiting for the deadline instead of racing ahead.
    if (!anyHuman) return false;
    const allDone = this.seats.every((id) => {
      const p = this.player(id);
      return !p || ts.submissions.has(id) || (!p.isBot && !p.online);
    });
    if (allDone) this.endTurn();
    return allDone;
  }

  private clearTurnTimers(): void {
    this.cancelTimers((t) => t.kind === "endTurn" || t.kind === "bot");
  }

  private endTurn(): void {
    const ts = this.ts;
    if (!ts || !this.isTurnPhase()) return;
    this.clearTurnTimers();

    for (const pid of this.seats) {
      const p = this.player(pid);
      const c = ts.chainOf.get(pid)!;
      const authorName = p?.name ?? "Someone";
      const sub = ts.submissions.get(pid);
      let step: Step;
      if (ts.kind === "prompt") {
        const text = (typeof sub === "string" && sub) || ts.dealt.get(pid) || this.randomWord();
        step = { kind: "prompt", authorId: pid, authorName, text };
      } else if (ts.kind === "draw") {
        const strokes = Array.isArray(sub) ? sub : (ts.autosaves.get(pid) ?? []);
        step = { kind: "drawing", authorId: pid, authorName, strokes };
      } else {
        const text = (typeof sub === "string" && sub) || "???";
        const auto = matchGuess(targetPhrase(this.chains[c], this.turn), text);
        step = { kind: "guess", authorId: pid, authorName, text, autoMatch: auto, match: auto, votes: [] };
      }
      this.chains[c][this.turn] = step;
    }

    this.turn++;
    this.ts = null;
    if (this.turn >= this.totalTurns) this.startReveal();
    else this.beginTurn();
  }

  // ============================================================ reveal

  private startReveal(): void {
    this.phase = "reveal";
    this.deadline = null;
    this.modifier = null;
    this.reveal = { chain: 0, step: 0 };
    for (const p of this.players) p.taskSeq++;
    this.broadcast();
    this.broadcastMsg(this.revealDataMsg(0, 0, 1));
  }

  private revealDataMsg(chain: number, fromStep: number, count: number): ServerMsg {
    return {
      type: "revealData",
      chainIndex: chain,
      ownerId: this.seats[chain],
      fromStep,
      steps: this.chains[chain].slice(fromStep, fromStep + count),
    };
  }

  /** After a (re)join during the reveal: send the revealed steps of the current chain. */
  private sendCurrentReveal(p: Player): void {
    if (this.phase !== "reveal" || !this.reveal || !p.conn) return;
    p.conn.send(this.revealDataMsg(this.reveal.chain, 0, this.reveal.step + 1));
  }

  private onRevealNext(): void {
    const r = this.reveal;
    if (!r) return;
    if (r.step < this.totalTurns - 1) {
      r.step++;
      this.broadcast();
      this.broadcastMsg(this.revealDataMsg(r.chain, r.step, 1));
    } else if (r.chain < this.chains.length - 1) {
      r.chain++;
      r.step = 0;
      this.broadcast();
      this.broadcastMsg(this.revealDataMsg(r.chain, 0, 1));
    } else {
      this.finishGame();
    }
  }

  private finishGame(): void {
    this.scores = scoreGame(this.chains, this.seats);
    for (const line of this.scores) {
      const p = this.player(line.playerId);
      if (p) p.score = line.points;
    }
    this.phase = "scores";
    // Keep the pointer at the very end so clients know how many chains there are.
    this.reveal = { chain: this.chains.length - 1, step: this.totalTurns - 1 };
    this.broadcast();
  }

  private onVote(p: Player, chain: unknown, step: unknown): void {
    const r = this.reveal;
    if (this.phase !== "reveal" || !r || p.isBot) return;
    if (chain !== r.chain || typeof step !== "number" || step > r.step) return;
    const s = this.chains[r.chain]?.[step];
    if (!s || s.kind !== "guess" || s.autoMatch !== "miss" || s.authorId === p.id) return;
    const i = s.votes.indexOf(p.id);
    if (i >= 0) s.votes.splice(i, 1);
    else s.votes.push(p.id);
    const eligible = this.players.filter((x) => !x.isBot && x.online && x.id !== s.authorId).length;
    s.match = finalMatch(s.autoMatch, s.votes.length, voteThreshold(eligible));
    this.broadcast();
  }

  private onReact(p: Player, emoji: unknown): void {
    if (typeof emoji !== "string" || !(REACTIONS as readonly string[]).includes(emoji)) return;
    const now = this.deps.now();
    if (now - p.lastReaction < REACTION_COOLDOWN_MS) return;
    p.lastReaction = now;
    const r: RecentReaction = { id: ++this.reactionSeq, emoji, playerId: p.id, at: now };
    this.reactions = [...this.reactions.filter((x) => now - x.at < REACTION_KEEP_MS), r].slice(-30);
    this.broadcastMsg({ type: "reaction", emoji, playerId: p.id, id: r.id });
  }

  private onGetChain(p: Player, chain: unknown): void {
    if (typeof chain !== "number" || !p.conn) return;
    const steps = this.chains[chain];
    if (!steps) return;
    let visible: Step[] | null = null;
    if (this.phase === "scores") visible = steps;
    else if (this.phase === "reveal" && this.reveal) {
      if (chain < this.reveal.chain) visible = steps;
      else if (chain === this.reveal.chain) visible = steps.slice(0, this.reveal.step + 1);
    }
    if (!visible) return; // never leak chains during play
    p.conn.send({ type: "chain", chainIndex: chain, ownerId: this.seats[chain], steps: visible });
  }

  private onPlayAgain(): void {
    for (const p of [...this.players]) if (!p.isBot && !p.online) this.removePlayer(p.id);
    this.phase = "lobby";
    this.seats = [];
    this.chains = [];
    this.turn = 0;
    this.totalTurns = 0;
    this.deadline = null;
    this.reveal = null;
    this.scores = null;
    this.modifier = null;
    this.ts = null;
    for (const p of this.players) {
      p.score = 0;
      p.rerollsLeft = REROLLS_PER_GAME;
      p.taskSeq++;
    }
    this.broadcast();
  }

  // ============================================================ poll mode (Vercel)

  /** The human player with this token, if any. */
  playerIdByToken(token: unknown): string | null {
    if (typeof token !== "string" || !token) return null;
    return this.players.find((p) => !p.isBot && p.token === token)?.id ?? null;
  }

  /** Record a check-in time for a player (poll mode). */
  seen(pid: string, at: number): void {
    const p = this.player(pid);
    if (p && !p.isBot && at > p.lastSeen) p.lastSeen = at;
  }

  /** Poll mode: players who checked in are online; those who stopped checking in have left. */
  sweepPresence(): void {
    if (this.presence !== "poll") return;
    const now = this.deps.now();
    for (const p of [...this.players]) {
      if (p.isBot || !this.player(p.id)) continue;
      const fresh = now - p.lastSeen < PRESENCE_MS;
      if (fresh && !p.online) {
        this.markOnline(p);
        if (!(this.isTurnPhase() && this.checkTurnComplete())) this.broadcast();
      } else if (!fresh && p.online) {
        p.online = false;
        this.onPlayerLeft(p);
      }
    }
  }

  /** Poll mode: link a one-request connection to a known player. */
  attach(conn: Connection, pid: string): void {
    const p = this.player(pid);
    if (!p) return;
    p.conn = conn;
    this.conns.set(conn, pid);
  }

  /** Poll mode: unlink a one-request connection (this does not mean the player left). */
  detach(conn: Connection): void {
    const pid = this.conns.get(conn);
    this.conns.delete(conn);
    const p = pid ? this.player(pid) : undefined;
    if (p && p.conn === conn) p.conn = null;
  }

  /**
   * Poll mode: send this player everything they're missing: the current state
   * (with their task if it changed), new reveal steps and recent reactions.
   */
  catchUp(pid: string, client: { taskSeq: number; revealChain: number; revealHave: number; lastReaction: number }): void {
    const p = this.player(pid);
    const conn = p?.conn;
    if (!p || !conn) return;
    p.sentTaskSeq = client.taskSeq;
    this.sendState(p);
    const r = this.reveal;
    if (this.phase === "reveal" && r) {
      const have = client.revealChain === r.chain ? Math.max(0, Math.min(client.revealHave, r.step + 1)) : 0;
      if (have <= r.step) conn.send(this.revealDataMsg(r.chain, have, r.step + 1 - have));
    }
    const now = this.deps.now();
    for (const x of this.reactions) {
      if (x.id > client.lastReaction && now - x.at < REACTION_KEEP_MS && x.playerId !== pid) {
        conn.send({ type: "reaction", emoji: x.emoji, playerId: x.playerId, id: x.id });
      }
    }
  }

  // ============================================================ save / load

  toSnapshot(): RoomSnapshot {
    const ts = this.ts;
    return {
      v: 1,
      players: this.players.map(({ conn: _conn, ...rest }) => rest),
      hostId: this.hostId,
      phase: this.phase,
      settings: this.settings,
      customWords: this.customWords,
      seats: this.seats,
      totalTurns: this.totalTurns,
      turn: this.turn,
      deadline: this.deadline,
      chains: this.chains,
      ts: ts
        ? {
            kind: ts.kind,
            tasks: [...ts.tasks],
            chainOf: [...ts.chainOf],
            submissions: [...ts.submissions],
            autosaves: [...ts.autosaves],
            dealt: [...ts.dealt],
          }
        : null,
      modifier: this.modifier,
      builtinDeck: this.builtinDeck,
      customDeck: this.customDeck,
      reveal: this.reveal,
      scores: this.scores,
      timers: this.timers,
      timerSeq: this.timerSeq,
      reactions: this.reactions,
      reactionSeq: this.reactionSeq,
    };
  }

  static fromSnapshot(code: string, deps: RoomDeps, snap: RoomSnapshot, presence: Presence = "socket"): GameRoom {
    const room = new GameRoom(code, deps, presence);
    room.players = snap.players.map((p) => ({ ...p, conn: null, lastSeen: p.lastSeen ?? 0, sentTaskSeq: p.sentTaskSeq ?? -1 }));
    room.hostId = snap.hostId;
    room.phase = snap.phase;
    room.settings = snap.settings;
    room.customWords = snap.customWords;
    room.seats = snap.seats;
    room.totalTurns = snap.totalTurns;
    room.turn = snap.turn;
    room.deadline = snap.deadline;
    room.chains = snap.chains;
    room.ts = snap.ts
      ? {
          kind: snap.ts.kind,
          tasks: new Map(snap.ts.tasks),
          chainOf: new Map(snap.ts.chainOf),
          submissions: new Map(snap.ts.submissions),
          autosaves: new Map(snap.ts.autosaves),
          dealt: new Map(snap.ts.dealt),
        }
      : null;
    room.modifier = snap.modifier;
    room.builtinDeck = snap.builtinDeck;
    room.customDeck = snap.customDeck;
    room.reveal = snap.reveal;
    room.scores = snap.scores;
    room.timers = snap.timers;
    room.timerSeq = snap.timerSeq;
    room.reactions = snap.reactions;
    room.reactionSeq = snap.reactionSeq;
    room.armWake();
    return room;
  }

  // ============================================================ output

  private player(id: string): Player | undefined {
    return this.players.find((p) => p.id === id);
  }

  private error(conn: Connection, message: string, code?: ErrorCode): void {
    conn.send({ type: "error", message, code });
  }

  private errorTo(p: Player, message: string, code?: ErrorCode): void {
    if (p.conn) this.error(p.conn, message, code);
  }

  private broadcastMsg(msg: ServerMsg): void {
    for (const p of this.players) p.conn?.send(msg);
  }

  publicRoom(): PublicRoom {
    const ts = this.ts;
    const r = this.reveal;
    const players: PublicPlayer[] = this.players.map((p) => ({
      id: p.id,
      name: p.name,
      colour: p.colour,
      isBot: p.isBot,
      connected: p.isBot || p.online,
      score: p.score,
      done: !!ts && ts.submissions.has(p.id),
    }));
    const revealMatches: RevealMatch[] = [];
    if (r) {
      this.chains[r.chain].forEach((s, i) => {
        if (i <= r.step && s.kind === "guess") {
          revealMatches.push({ step: i, autoMatch: s.autoMatch, match: s.match, votes: [...s.votes] });
        }
      });
    }
    return {
      code: this.code,
      hostId: this.hostId,
      phase: this.phase,
      turn: this.turn,
      totalTurns: this.totalTurns,
      deadline: this.deadline,
      settings: this.settings,
      customWordCount: this.customWords.length,
      players,
      modifier: this.modifier,
      reveal: r
        ? {
            chain: r.chain,
            step: r.step,
            chainCount: this.chains.length,
            chainLength: this.totalTurns,
            owners: [...this.seats],
          }
        : null,
      revealMatches,
      scores: this.scores,
    };
  }

  private taskFor(p: Player): Task | null {
    const ts = this.ts;
    if (!ts || !this.isTurnPhase()) return null;
    const task = ts.tasks.get(p.id);
    if (!task) return null;
    if (task.kind === "draw") {
      const draft = ts.autosaves.get(p.id);
      if (draft && (draft.length || isStrokeRef(draft))) return { ...task, draft };
    }
    return task;
  }

  private sendState(p: Player, room: PublicRoom = this.publicRoom(), forceTask = false): void {
    if (!p.conn) return;
    const includeTask = forceTask || p.sentTaskSeq !== p.taskSeq;
    const you = {
      taskSeq: p.taskSeq,
      submitted: !!this.ts && this.ts.submissions.has(p.id),
      ...(includeTask ? { task: this.taskFor(p) } : {}),
    };
    p.sentTaskSeq = p.taskSeq;
    p.conn.send({ type: "state", room, you, serverNow: this.deps.now() });
  }

  /** Send state to everyone. `forceTaskFor` gets their full task even if unchanged (after a reconnect). */
  private broadcast(forceTaskFor?: string): void {
    const room = this.publicRoom();
    for (const p of this.players) this.sendState(p, room, p.id === forceTaskFor);
  }
}

// ---------------------------------------------------------------- bot art

/** A few random coloured loops and lines. */
export function botDrawing(random: () => number): Stroke[] {
  const colours = PALETTE.filter((c) => c !== "#ffffff" && c !== "#d1d1d1");
  const strokes: Stroke[] = [];
  const count = 2 + Math.floor(random() * 4);
  let t = 0;
  for (let i = 0; i < count; i++) {
    const colour = colours[Math.floor(random() * colours.length) % colours.length];
    const size = PEN_SIZES[Math.floor(random() * PEN_SIZES.length) % PEN_SIZES.length];
    const points: Point[] = [];
    if (random() < 0.5) {
      const cx = 150 + random() * (CANVAS_W - 300);
      const cy = 150 + random() * (CANVAS_H - 300);
      const rx = 40 + random() * 120;
      const ry = 40 + random() * 120;
      const steps = 28;
      for (let k = 0; k <= steps; k++) {
        const a = (k / steps) * Math.PI * 2;
        points.push([Math.round(cx + Math.cos(a) * rx), Math.round(cy + Math.sin(a) * ry), Math.round(t)]);
        t += 16;
      }
    } else {
      let x = 100 + random() * (CANVAS_W - 200);
      let y = 100 + random() * (CANVAS_H - 200);
      let dir = random() * Math.PI * 2;
      for (let k = 0; k < 24; k++) {
        points.push([Math.round(x), Math.round(y), Math.round(t)]);
        dir += (random() - 0.5) * 0.8;
        x = Math.min(CANVAS_W - 10, Math.max(10, x + Math.cos(dir) * 14));
        y = Math.min(CANVAS_H - 10, Math.max(10, y + Math.sin(dir) * 14));
        t += 16;
      }
    }
    t += 250;
    strokes.push({ tool: "pen", colour, size, points });
  }
  return strokes;
}
