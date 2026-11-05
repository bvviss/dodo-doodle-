import { describe, expect, it } from "vitest";
import { GameRoom, type Connection, type RoomDeps } from "../worker/room";
import { GRACE_MS, type ClientMsg, type PublicRoom, type ServerMsg, type Step, type Task } from "../shared/types";

// ---------------------------------------------------------------- fakes

class FakeClock {
  time = 1_000_000;
  private nextId = 1;
  private timers = new Map<number, { at: number; fn: () => void }>();

  deps(seed = 42): RoomDeps {
    let s = seed;
    let id = 0;
    return {
      now: () => this.time,
      setTimer: (fn, ms) => {
        const h = this.nextId++;
        this.timers.set(h, { at: this.time + Math.max(0, ms), fn });
        return h;
      },
      clearTimer: (h) => {
        this.timers.delete(h as number);
      },
      random: () => {
        // mulberry32
        s |= 0;
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      },
      makeId: () => `id${++id}`,
    };
  }

  /** Move time forward, running every timer that comes due (in order). */
  advance(ms: number): void {
    const end = this.time + ms;
    for (;;) {
      let next: [number, { at: number; fn: () => void }] | null = null;
      for (const entry of this.timers) if (entry[1].at <= end && (!next || entry[1].at < next[1].at)) next = entry;
      if (!next) break;
      this.timers.delete(next[0]);
      this.time = next[1].at;
      next[1].fn();
    }
    this.time = end;
  }
}

class FakeConn implements Connection {
  msgs: ServerMsg[] = [];
  closed = false;
  room: GameRoom;
  task: Task | null = null;
  constructor(room: GameRoom) {
    this.room = room;
    room.connect(this);
  }
  send(msg: ServerMsg) {
    if (this.closed) return;
    // Round-trip through JSON like a real socket.
    const m = JSON.parse(JSON.stringify(msg)) as ServerMsg;
    this.msgs.push(m);
    if (m.type === "state" && m.you.task !== undefined) this.task = m.you.task;
  }
  close() {
    this.closed = true;
    this.room.disconnect(this);
  }
  do(msg: ClientMsg) {
    this.room.message(this, JSON.stringify(msg));
  }
  get state() {
    const s = [...this.msgs].reverse().find((m) => m.type === "state");
    if (!s || s.type !== "state") throw new Error("no state yet");
    return s;
  }
  get room_(): PublicRoom {
    return this.state.room;
  }
  get welcome() {
    const w = this.msgs.find((m) => m.type === "welcome");
    if (!w || w.type !== "welcome") throw new Error("no welcome");
    return w;
  }
  of<T extends ServerMsg["type"]>(type: T): Extract<ServerMsg, { type: T }>[] {
    return this.msgs.filter((m) => m.type === type) as Extract<ServerMsg, { type: T }>[];
  }
}

function setup(seed = 42) {
  const clock = new FakeClock();
  const room = new GameRoom("BCDF", clock.deps(seed));
  return { clock, room };
}

function join(room: GameRoom, name: string, token?: string) {
  const c = new FakeConn(room);
  c.do({ type: "join", name, colour: "#3a86ff", token });
  return c;
}

/** Answer the current task like a reasonable human would. */
function answer(c: FakeConn) {
  const t = c.task;
  if (!t) return;
  if (t.kind === "prompt") c.do({ type: "submit", text: t.dealt ?? "a cat doing taxes" });
  else if (t.kind === "draw") c.do({ type: "submit", strokes: [{ tool: "pen", colour: "#e63946", size: 8, points: [[10, 10, 0], [200, 200, 50]] }] });
  else c.do({ type: "submit", text: "cat" });
}

// ---------------------------------------------------------------- tests

describe("lobby", () => {
  it("first player is host; players join with unique names", () => {
    const { room } = setup();
    const a = join(room, "Sam");
    const b = join(room, "sam");
    expect(a.welcome.playerId).toBeTruthy();
    expect(b.room_.hostId).toBe(a.welcome.playerId);
    expect(b.room_.players.map((p) => p.name)).toEqual(["Sam", "sam 2"]);
  });

  it("only the host can change settings, and settings are sanitized", () => {
    const { room } = setup();
    const a = join(room, "Host");
    const b = join(room, "Guest");
    b.do({ type: "settings", settings: { drawTime: 120 } });
    expect(a.room_.settings.drawTime).toBe(75);
    a.do({ type: "settings", settings: { drawTime: 120, guessTime: 999 as never } });
    expect(b.room_.settings.drawTime).toBe(120);
    expect(b.room_.settings.guessTime).toBe(40);
    a.do({ type: "settings", settings: {}, customWords: ["one", "two", "two"] });
    expect(b.room_.customWordCount).toBe(2);
  });

  it("bots can be added and removed; max 10 players", () => {
    const { room } = setup();
    const a = join(room, "Host");
    for (let i = 0; i < 12; i++) a.do({ type: "addBot" });
    expect(a.room_.players.length).toBe(10);
    expect(a.of("error").length).toBeGreaterThan(0);
    a.do({ type: "removeBot" });
    expect(a.room_.players.length).toBe(9);
    const late = join(room, "Late");
    expect(late.room_.players.length).toBe(10);
    const tooLate = join(room, "Too late");
    expect(tooLate.of("error")[0].code).toBe("full");
  });

  it("needs 3 players to start", () => {
    const { room } = setup();
    const a = join(room, "Host");
    a.do({ type: "addBot" });
    a.do({ type: "start" });
    expect(a.room_.phase).toBe("lobby");
    expect(a.of("error").length).toBe(1);
    a.do({ type: "addBot" });
    a.do({ type: "start" });
    expect(a.room_.phase).toBe("prompt");
  });

  it("host can kick; host passes on when the host leaves", () => {
    const { room } = setup();
    const a = join(room, "Host");
    const b = join(room, "B");
    const c = join(room, "C");
    a.do({ type: "kick", playerId: c.welcome.playerId });
    expect(c.closed).toBe(true);
    expect(c.of("error")[0].code).toBe("kicked");
    expect(a.room_.players.map((p) => p.name)).toEqual(["Host", "B"]);
    a.close();
    expect(b.room_.hostId).toBe(b.welcome.playerId);
    expect(b.room_.players.find((p) => p.name === "Host")?.connected).toBe(false);
  });

  it("disconnected lobby players are removed after a while", () => {
    const { room, clock } = setup();
    const a = join(room, "Host");
    const b = join(room, "B");
    b.close();
    clock.advance(120_000);
    expect(a.room_.players.map((p) => p.name)).toEqual(["Host"]);
  });

  it("can't join a game in progress", () => {
    const { room } = setup();
    const a = join(room, "Host");
    a.do({ type: "addBot" });
    a.do({ type: "addBot" });
    a.do({ type: "start" });
    const late = join(room, "Late");
    expect(late.of("error")[0].code).toBe("in_progress");
    expect(late.of("state").length).toBe(0);
  });

  it("call link must be https", () => {
    const { room } = setup();
    const a = join(room, "Host");
    a.do({ type: "settings", settings: { callLink: "http://bad.example" } });
    expect(a.room_.settings.callLink).toBe("");
    a.do({ type: "settings", settings: { callLink: "https://discord.gg/abc" } });
    expect(a.room_.settings.callLink).toBe("https://discord.gg/abc");
  });

  it("answers pings for clock sync", () => {
    const { room, clock } = setup();
    const c = new FakeConn(room);
    c.do({ type: "ping", t: 5 });
    expect(c.of("pong")[0]).toEqual({ type: "pong", t: 5, serverNow: clock.time });
  });
});

describe("full game", () => {
  it("plays host + bots from start to scores, including a turn with no submission", () => {
    const { room, clock } = setup(7);
    const host = join(room, "Host");
    for (let i = 0; i < 5; i++) host.do({ type: "addBot" });
    host.do({ type: "start" });
    const total = host.room_.totalTurns;
    expect(total).toBe(5); // 6 players → 5 steps
    const deadlines: number[] = [];

    for (let turn = 0; turn < total; turn++) {
      const r = host.room_;
      expect(r.turn).toBe(turn);
      expect(r.phase).toBe(turn === 0 ? "prompt" : turn % 2 ? "draw" : "guess");
      expect(host.task?.kind).toBe(r.phase);
      deadlines.push(r.deadline!);
      if (turn === 2) {
        // Host doesn't answer: the turn ends at deadline + grace with "???".
        clock.advance(r.deadline! - clock.time + GRACE_MS - 1);
        expect(host.room_.turn).toBe(turn);
        clock.advance(1);
      } else {
        answer(host);
        expect(host.state.you.submitted).toBe(true);
        clock.advance(5000); // bots finish within 3.7 s
      }
      expect(host.room_.turn).toBe(turn + 1 === total ? total : turn + 1);
    }

    expect(host.room_.phase).toBe("reveal");
    const reveal = host.room_.reveal!;
    expect(reveal.chainCount).toBe(6);
    expect(reveal.chainLength).toBe(5);

    // Reveal every step of every chain.
    const seen = new Map<number, Step[]>();
    const collect = () => {
      for (const m of host.of("revealData")) {
        const arr = seen.get(m.chainIndex) ?? [];
        m.steps.forEach((s, i) => (arr[m.fromStep + i] = s));
        seen.set(m.chainIndex, arr);
      }
    };
    let clicks = 0;
    while (host.room_.phase === "reveal") {
      host.do({ type: "revealNext" });
      clicks++;
      expect(clicks).toBeLessThan(100);
    }
    collect();
    expect(clicks).toBe(6 * 5);
    expect(seen.size).toBe(6);
    for (const [, steps] of seen) {
      expect(steps.length).toBe(5);
      expect(steps.map((s) => s.kind)).toEqual(["prompt", "drawing", "guess", "drawing", "guess"]);
    }
    // The host's missed guess was filled in.
    const hostId = host.welcome.playerId;
    const hostGuess = [...seen.values()].map((s) => s[2]).find((s) => s.authorId === hostId);
    expect(hostGuess?.kind === "guess" && hostGuess.text).toBe("???");

    const r = host.room_;
    expect(r.phase).toBe("scores");
    expect(r.scores!.length).toBe(6);
    const sorted = [...r.scores!].sort((a, b) => b.points - a.points);
    expect(r.scores).toEqual(sorted);
    expect(r.players.find((p) => p.id === r.scores![0].playerId)!.score).toBe(r.scores![0].points);
    // Bots guess right half the time, so someone should have points.
    expect(r.scores![0].points).toBeGreaterThan(0);

    // Any chain can be fetched in the scores phase.
    host.do({ type: "getChain", chain: 3 });
    expect(host.of("chain")[0].steps.length).toBe(5);

    // Play again → lobby with same players, scores reset.
    host.do({ type: "playAgain" });
    expect(host.room_.phase).toBe("lobby");
    expect(host.room_.players.length).toBe(6);
    expect(host.room_.players.every((p) => p.score === 0)).toBe(true);
    host.do({ type: "start" });
    expect(host.room_.phase).toBe("prompt");
  });

  it("ends a turn when everyone connected has submitted", () => {
    const { room, clock } = setup();
    const a = join(room, "A");
    const b = join(room, "B");
    const c = join(room, "C");
    a.do({ type: "start" });
    answer(a);
    answer(b);
    expect(a.room_.turn).toBe(0);
    expect(a.room_.players.filter((p) => p.done).length).toBe(2);
    c.close(); // disconnected players are not waited for
    expect(a.room_.turn).toBe(1);
    clock.advance(10);
    expect(a.task?.kind).toBe("draw");
  });

  it("uses the autosave when a drawing times out", () => {
    const { room, clock } = setup();
    const a = join(room, "A");
    const b = join(room, "B");
    const c = join(room, "C");
    a.do({ type: "start" });
    [a, b, c].forEach(answer);
    expect(a.room_.phase).toBe("draw");
    const strokes = [{ tool: "pen" as const, colour: "#1b1b1b", size: 4, points: [[1, 2, 0]] as [number, number, number][] }];
    a.do({ type: "autosave", strokes });
    answer(b);
    answer(c);
    clock.advance(a.room_.deadline! - clock.time + GRACE_MS);
    expect(a.room_.phase).toBe("guess");
    // Finish the game and check A's drawing was saved.
    [a, b, c].forEach(answer);
    expect(a.room_.phase).toBe("reveal");
    while (a.room_.phase === "reveal") a.do({ type: "revealNext" });
    a.do({ type: "getChain", chain: 0 });
    a.do({ type: "getChain", chain: 1 });
    a.do({ type: "getChain", chain: 2 });
    const aDrawing = a
      .of("chain")
      .map((m) => m.steps[1])
      .find((s) => s.authorId === a.welcome.playerId);
    expect(aDrawing?.kind === "drawing" && aDrawing.strokes).toEqual(strokes);
  });

  it("deals prompts from packs, with one re-roll per game", () => {
    const { room } = setup();
    const a = join(room, "A");
    a.do({ type: "addBot" });
    a.do({ type: "addBot" });
    a.do({ type: "settings", settings: { promptSource: "packs", packs: ["food"], difficulty: "easy" } });
    a.do({ type: "start" });
    const t1 = a.task;
    expect(t1?.kind === "prompt" && t1.dealt).toBeTruthy();
    expect(t1?.kind === "prompt" && t1.rerollsLeft).toBe(1);
    a.do({ type: "reroll" });
    const t2 = a.task;
    expect(t2?.kind === "prompt" && t2.dealt).not.toBe(t1?.kind === "prompt" && t1.dealt);
    expect(t2?.kind === "prompt" && t2.rerollsLeft).toBe(0);
    a.do({ type: "reroll" });
    expect(a.of("error").length).toBe(1);
    a.do({ type: "submit", text: "something else entirely" });
    // The dealt word is kept, not the client's text.
    expect(a.state.you.submitted).toBe(true);
  });

  it("custom pack must not be empty", () => {
    const { room } = setup();
    const a = join(room, "A");
    a.do({ type: "addBot" });
    a.do({ type: "addBot" });
    a.do({ type: "settings", settings: { promptSource: "custom" } });
    a.do({ type: "start" });
    expect(a.room_.phase).toBe("lobby");
    a.do({ type: "settings", settings: {}, customWords: ["teh tarik"] });
    a.do({ type: "start" });
    expect(a.task?.kind === "prompt" && a.task.dealt).toBe("teh tarik");
  });

  it("modifiers: draw turns sometimes get one, with a banner delay", () => {
    const { room, clock } = setup(3);
    const a = join(room, "A");
    for (let i = 0; i < 9; i++) a.do({ type: "addBot" });
    a.do({ type: "settings", settings: { modifiers: "random" } });
    let found = 0;
    for (let game = 0; game < 6; game++) {
      a.do({ type: "start" });
      while (a.room_.phase !== "reveal") {
        const r = a.room_;
        if (r.phase === "draw" && r.modifier) {
          found++;
          const t = a.task;
          expect(t?.kind === "draw" && t.modifier?.id).toBe(r.modifier.id);
          const startsAt = t?.kind === "draw" ? t.startsAt : 0;
          expect(r.deadline! - startsAt).toBe(r.modifier.id === "speed" ? 30_000 : 75_000);
        }
        if (r.phase !== "draw") expect(r.modifier).toBeNull();
        answer(a);
        clock.advance(8000);
      }
      while (a.room_.phase === "reveal") a.do({ type: "revealNext" });
      a.do({ type: "playAgain" });
    }
    expect(found).toBeGreaterThan(0);
  });
});

describe("reconnect", () => {
  it("reconnects with a token mid-game and lands in the same turn", () => {
    const { room, clock } = setup();
    const a = join(room, "A");
    a.do({ type: "addBot" });
    a.do({ type: "addBot" });
    a.do({ type: "start" });
    answer(a);
    clock.advance(5000);
    expect(a.room_.phase).toBe("draw");
    const token = a.welcome.token;
    const id = a.welcome.playerId;
    const strokes = [{ tool: "pen" as const, colour: "#1b1b1b", size: 4, points: [[5, 5, 0]] as [number, number, number][] }];
    a.do({ type: "autosave", strokes });
    a.close();
    clock.advance(500);
    expect(room.publicRoom().players.find((p) => p.id === id)?.connected).toBe(false);

    const a2 = join(room, "whatever", token);
    expect(a2.welcome.playerId).toBe(id);
    expect(a2.room_.phase).toBe("draw");
    expect(a2.room_.players.find((p) => p.id === id)?.connected).toBe(true);
    expect(a2.room_.players.find((p) => p.id === id)?.name).toBe("A");
    // Full task is resent, including the autosaved drawing.
    expect(a2.task?.kind).toBe("draw");
    expect(a2.task?.kind === "draw" && a2.task.draft).toEqual(strokes);
    expect(a2.room_.hostId).toBe(id);
  });

  it("reconnecting during the reveal resends the current chain's revealed steps", () => {
    const { room, clock } = setup();
    const a = join(room, "A");
    const b = join(room, "B");
    a.do({ type: "addBot" });
    a.do({ type: "start" });
    while (a.room_.phase !== "reveal") {
      answer(a);
      answer(b);
      clock.advance(5000);
    }
    a.do({ type: "revealNext" });
    a.do({ type: "revealNext" });
    const token = b.welcome.token;
    b.close();
    const b2 = join(room, "B", token);
    const rd = b2.of("revealData");
    expect(rd.length).toBe(1);
    expect(rd[0].fromStep).toBe(0);
    expect(rd[0].steps.length).toBe(3);
  });

  it("a second connection with the same token replaces the first", () => {
    const { room } = setup();
    const a = join(room, "A");
    const a2 = join(room, "A", a.welcome.token);
    expect(a.closed).toBe(true);
    expect(a2.room_.players.length).toBe(1);
    expect(a2.room_.players[0].connected).toBe(true);
  });
});

describe("anti-peeking", () => {
  it("state never contains other chains during play", () => {
    const { room, clock } = setup();
    const a = join(room, "A");
    const b = join(room, "B");
    const c = join(room, "C");
    a.do({ type: "addBot" });
    a.do({ type: "settings", settings: { promptSource: "player" } });
    a.do({ type: "start" });
    const secret = { A: "secret alpha", B: "secret bravo", C: "secret charlie" };
    a.do({ type: "submit", text: secret.A });
    b.do({ type: "submit", text: secret.B });
    c.do({ type: "submit", text: secret.C });
    clock.advance(5000);
    while (a.room_.phase !== "reveal") {
      [a, b, c].forEach(answer);
      clock.advance(5000);
    }
    // During play, A must only ever see the phrase they were asked to draw — never B's or C's other chains.
    for (const [conn, own] of [
      [a, secret.A],
      [b, secret.B],
      [c, secret.C],
    ] as const) {
      const duringPlay = conn.msgs.filter((m) => m.type === "state" && m.room.phase !== "reveal");
      const others = Object.values(secret).filter((s) => s !== own);
      const json = JSON.stringify(duringPlay);
      // Each player draws exactly one other prompt on turn 1; they may see that one only.
      const visible = others.filter((s) => json.includes(s));
      expect(visible.length).toBeLessThanOrEqual(1);
      // No chain/reveal data before the reveal.
      const before = conn.msgs.slice(0, conn.msgs.findIndex((m) => m.type === "state" && m.room.phase === "reveal"));
      expect(before.some((m) => m.type === "revealData" || m.type === "chain")).toBe(false);
      // Room state has no chain contents.
      for (const m of duringPlay) if (m.type === "state") expect(JSON.stringify(m.room)).not.toMatch(/secret/);
    }
    // getChain is refused during play.
    const { room: room2 } = setup();
    const x = join(room2, "X");
    x.do({ type: "addBot" });
    x.do({ type: "addBot" });
    x.do({ type: "start" });
    x.do({ type: "getChain", chain: 0 });
    expect(x.of("chain").length).toBe(0);
  });

  it("guess tasks only contain the drawing you must guess", () => {
    const { room, clock } = setup();
    const a = join(room, "A");
    a.do({ type: "addBot" });
    a.do({ type: "addBot" });
    a.do({ type: "start" });
    answer(a);
    clock.advance(5000);
    answer(a);
    clock.advance(5000);
    expect(a.room_.phase).toBe("guess");
    const t = a.task;
    expect(t?.kind).toBe("guess");
    expect(Object.keys(t!)).toEqual(["kind", "strokes"]);
  });
});

describe("votes", () => {
  it("close-enough votes upgrade a miss, and toggling removes the vote", () => {
    const { room, clock } = setup(11);
    const a = join(room, "A");
    const b = join(room, "B");
    const c = join(room, "C");
    a.do({ type: "start" });
    a.do({ type: "submit", text: "cat" });
    b.do({ type: "submit", text: "dog" });
    c.do({ type: "submit", text: "fish" });
    [a, b, c].forEach((x) => x.do({ type: "submit", strokes: [] }));
    [a, b, c].forEach((x) => x.do({ type: "submit", text: "zebra" })); // all wrong
    clock.advance(10);
    expect(a.room_.phase).toBe("reveal");
    a.do({ type: "revealNext" });
    a.do({ type: "revealNext" });
    const m = a.room_.revealMatches.find((x) => x.step === 2)!;
    expect(m.autoMatch).toBe("miss");
    const owners = a.room_.reveal!.owners;
    // Find the guesser of chain 0, step 2: seat (0 + 2) % 3.
    const guesserConn = [a, b, c].find((x) => x.welcome.playerId !== owners[0] && x.welcome.playerId !== owners[1])!;
    const voters = [a, b, c].filter((x) => x !== guesserConn);
    // The guesser can't vote for themselves.
    guesserConn.do({ type: "vote", chain: 0, step: 2 });
    expect(a.room_.revealMatches[0].votes.length).toBe(0);
    // 2 eligible voters → threshold 1.
    voters[0].do({ type: "vote", chain: 0, step: 2 });
    expect(a.room_.revealMatches[0].match).toBe("close");
    voters[0].do({ type: "vote", chain: 0, step: 2 });
    expect(a.room_.revealMatches[0].match).toBe("miss");
    voters[1].do({ type: "vote", chain: 0, step: 2 });
    expect(a.room_.revealMatches[0].match).toBe("close");
    // Finish: the upgraded guess scores 50 for guesser and drawer + chain bonus (3-step chain).
    while (a.room_.phase === "reveal") a.do({ type: "revealNext" });
    const guesserScore = a.room_.scores!.find((s) => s.playerId === guesserConn.welcome.playerId)!;
    expect(guesserScore.close).toBe(1);
    expect(guesserScore.chainBonus).toBe(50);
  });

  it("reactions are broadcast and rate limited", () => {
    const { room, clock } = setup();
    const a = join(room, "A");
    const b = join(room, "B");
    a.do({ type: "react", emoji: "😂" });
    a.do({ type: "react", emoji: "😂" });
    a.do({ type: "react", emoji: "🍕" });
    expect(b.of("reaction").length).toBe(1);
    clock.advance(400);
    a.do({ type: "react", emoji: "💀" });
    expect(b.of("reaction").length).toBe(2);
  });
});
