// Game rules shared by browser and server: chain length, passing rule,
// text matching, scoring, settings + input validation, modifiers.

import {
  CANVAS_H,
  CANVAS_W,
  CHAIN_LENGTHS,
  DRAW_TIMES,
  GUESS_TIMES,
  LIMITS,
  PALETTE,
  PROMPT_TIMES,
  type ActiveModifier,
  type Difficulty,
  type GuessStep,
  type Match,
  type ModifierId,
  type ModifierMode,
  type PackId,
  type Point,
  type PromptSource,
  type ScoreLine,
  type Settings,
  type Step,
  type Stroke,
  type Tool,
  type TurnKind,
} from "./types";

// ================================================================= turns

/**
 * Number of steps in every chain. Chains always end on a guess, so the
 * length is always odd: prompt, draw, guess, draw, guess…
 * `cap` = 0 means "full circle".
 */
export function chainLength(players: number, cap: number): number {
  let len = cap > 0 ? Math.min(cap, players) : players;
  if (len % 2 === 0) len -= 1;
  return Math.max(3, len);
}

export function turnKind(turn: number): TurnKind {
  if (turn === 0) return "prompt";
  return turn % 2 === 1 ? "draw" : "guess";
}

/** Passing rule: on turn t, the player in seat s works on chain (s - t) mod n. */
export function chainForSeat(seat: number, turn: number, n: number): number {
  return (((seat - turn) % n) + n) % n;
}

/** Inverse of chainForSeat: who works on chain c on turn t. */
export function seatForChain(chain: number, turn: number, n: number): number {
  return (chain + turn) % n;
}

// ================================================================= text matching

const STOPWORDS = new Set(["a", "an", "the", "some", "of"]);

export function singular(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (/(ch|sh|ss|x|z)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s") && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

/** Lowercase, strip accents + punctuation, hyphens → spaces, drop stopwords, singularize. */
export function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[-_/]/g, " ")
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w))
    .map(singular);
}

/** Levenshtein edit distance. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

function typoAllowance(len: number): number {
  if (len <= 3) return 0;
  if (len <= 5) return 1;
  return 2;
}

/** Compare a guess with the phrase the drawer was given. */
export function matchGuess(target: string, guess: string): Match {
  if (!guess || guess.trim() === "" || guess.trim() === "???") return "miss";
  const t = normalizeWords(target);
  const g = normalizeWords(guess);
  if (!t.length || !g.length) return "miss";

  const tj = t.join("");
  const gj = g.join("");
  if (tj === gj) return "exact";
  const allowance = typoAllowance(Math.min(tj.length, gj.length));
  if (allowance > 0 && Math.abs(tj.length - gj.length) <= allowance && editDistance(tj, gj) <= allowance) {
    return "exact";
  }

  for (const tw of t) {
    for (const gw of g) {
      if (tw.length >= 3 && tw === gw) return "close";
      if (tw.length >= 5 && gw.length >= 5 && editDistance(tw, gw) <= 1) return "close";
    }
  }
  return "miss";
}

// ================================================================= votes + scoring

/** Votes needed to upgrade a miss to close: half the eligible voters, rounded up, min 1. */
export function voteThreshold(eligibleVoters: number): number {
  return Math.max(1, Math.ceil(eligibleVoters / 2));
}

/** Final match of a guess given its votes. Votes only upgrade misses. */
export function finalMatch(autoMatch: Match, votes: number, threshold: number): Match {
  if (autoMatch === "miss" && votes >= threshold) return "close";
  return autoMatch;
}

export const POINTS = { exact: 100, close: 50, chainBonus: 50 } as const;

/** The phrase a guess is compared with: the text two steps earlier. */
export function targetPhrase(chain: Step[], guessIndex: number): string {
  const s = chain[guessIndex - 2];
  return s && s.kind !== "drawing" ? s.text : "";
}

/** Did the chain survive: final guess still matches the original prompt? */
export function chainSurvived(chain: Step[]): boolean {
  const first = chain[0];
  const last = chain[chain.length - 1];
  if (!first || first.kind !== "prompt" || !last || last.kind !== "guess") return false;
  // With 3 steps the final guess IS compared with the prompt, so votes count.
  if (chain.length === 3) return last.match !== "miss";
  return matchGuess(first.text, last.text) !== "miss";
}

/**
 * Score a finished game. Each guess is scored against the phrase the drawer
 * was given; the drawer earns the same points as the guesser. If a chain's
 * final guess still matches the original prompt, everyone in it gets +50.
 */
export function scoreGame(chains: Step[][], playerIds: string[]): ScoreLine[] {
  const lines = new Map<string, ScoreLine>();
  for (const id of playerIds) lines.set(id, { playerId: id, points: 0, exact: 0, close: 0, chainBonus: 0 });
  const line = (id: string) => {
    let l = lines.get(id);
    if (!l) {
      l = { playerId: id, points: 0, exact: 0, close: 0, chainBonus: 0 };
      lines.set(id, l);
    }
    return l;
  };

  for (const chain of chains) {
    for (let i = 2; i < chain.length; i += 2) {
      const guess = chain[i];
      const drawing = chain[i - 1];
      if (!guess || guess.kind !== "guess" || !drawing) continue;
      if (guess.match === "miss") continue;
      const pts = guess.match === "exact" ? POINTS.exact : POINTS.close;
      for (const id of [guess.authorId, drawing.authorId]) {
        const l = line(id);
        l.points += pts;
        if (guess.match === "exact") l.exact++;
        else l.close++;
      }
    }
    if (chainSurvived(chain)) {
      for (const id of new Set(chain.map((s) => s.authorId))) {
        const l = line(id);
        l.points += POINTS.chainBonus;
        l.chainBonus += POINTS.chainBonus;
      }
    }
  }
  return [...lines.values()].sort((a, b) => b.points - a.points);
}

export function isGuess(step: Step | undefined): step is GuessStep {
  return !!step && step.kind === "guess";
}

// ================================================================= modifiers

/**
 * Round modifiers. To add one: add its id to `ModifierId` in types.ts, an entry
 * here, and (if it changes the canvas) a flag in `CanvasFlags` that the canvas obeys.
 */
export const MODIFIERS: Record<ModifierId, (random: () => number) => ActiveModifier> = {
  speed: () => ({
    id: "speed",
    name: "Speed round",
    description: "Only 30 seconds to draw!",
    emoji: "⚡",
    canvas: {},
    drawTime: 30,
  }),
  threeColours: (random) => ({
    id: "threeColours",
    name: "Three colours",
    description: "Your palette shrinks to just 3 colours.",
    emoji: "🎨",
    canvas: { palette: pickN(PALETTE.filter((c) => c !== "#1b1b1b" && c !== "#ffffff"), 3, random) },
  }),
  noUndo: () => ({
    id: "noUndo",
    name: "No undo",
    description: "No undo, no eraser, no clear. Commit to every line!",
    emoji: "🚫",
    canvas: { noUndo: true },
  }),
};

export const MODIFIER_CHANCE = 1 / 3;

/** Decide the modifier for a draw turn (or null). */
export function pickModifier(mode: ModifierMode, random: () => number): ActiveModifier | null {
  if (mode !== "random") return null;
  if (random() >= MODIFIER_CHANCE) return null;
  const ids = Object.keys(MODIFIERS) as ModifierId[];
  const id = ids[Math.floor(random() * ids.length) % ids.length];
  return MODIFIERS[id](random);
}

// ================================================================= helpers

export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pickN<T>(items: readonly T[], n: number, random: () => number): T[] {
  return shuffle(items, random).slice(0, n);
}

// ================================================================= validation

export const ALL_PACKS: PackId[] = ["animals", "food", "objects", "actions", "places", "jobs", "silly"];
const PROMPT_SOURCES: PromptSource[] = ["player", "packs", "custom", "mix"];
const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];
const MODIFIER_MODES: ModifierMode[] = ["off", "random"];

export const DEFAULT_SETTINGS: Settings = {
  promptSource: "player",
  packs: [...ALL_PACKS],
  difficulty: "medium",
  promptTime: 45,
  drawTime: 75,
  guessTime: 40,
  chainLength: 0,
  modifiers: "off",
  callLink: "",
};

function oneOf<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function isValidCallLink(link: string): boolean {
  if (!link.startsWith("https://") || link.length > LIMITS.maxCallLink) return false;
  try {
    const u = new URL(link);
    return u.protocol === "https:" && !!u.hostname && u.hostname.includes(".");
  } catch {
    return false;
  }
}

/** Merge a (possibly hostile) settings update into the previous settings. Invalid values are ignored. */
export function sanitizeSettings(input: unknown, prev: Settings = DEFAULT_SETTINGS): Settings {
  const s: Record<string, unknown> = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  let packs = prev.packs;
  if (Array.isArray(s.packs)) {
    const valid = ALL_PACKS.filter((p) => (s.packs as unknown[]).includes(p));
    if (valid.length > 0) packs = valid;
  }
  let callLink = prev.callLink;
  if (typeof s.callLink === "string") {
    const link = s.callLink.trim();
    if (link === "" || isValidCallLink(link)) callLink = link;
  }
  return {
    promptSource: oneOf(s.promptSource, PROMPT_SOURCES, prev.promptSource),
    packs,
    difficulty: oneOf(s.difficulty, DIFFICULTIES, prev.difficulty),
    promptTime: oneOf(s.promptTime, PROMPT_TIMES, prev.promptTime),
    drawTime: oneOf(s.drawTime, DRAW_TIMES, prev.drawTime),
    guessTime: oneOf(s.guessTime, GUESS_TIMES, prev.guessTime),
    chainLength: oneOf(s.chainLength, CHAIN_LENGTHS, prev.chainLength),
    modifiers: oneOf(s.modifiers, MODIFIER_MODES, prev.modifiers),
    callLink,
  };
}

/** Trim, collapse whitespace, cap length. Strips control characters. */
export function sanitizeText(input: unknown, max: number = LIMITS.maxText): string {
  if (typeof input !== "string") return "";
  return input
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

/** Make a player name valid and unique among `taken` (case-insensitive). */
export function sanitizeName(input: unknown, taken: string[]): string {
  let base = sanitizeText(input, LIMITS.maxName) || "Player";
  const lower = new Set(taken.map((t) => t.toLowerCase()));
  if (!lower.has(base.toLowerCase())) return base;
  for (let i = 2; i < 100; i++) {
    const suffix = ` ${i}`;
    const name = base.slice(0, LIMITS.maxName - suffix.length).trimEnd() + suffix;
    if (!lower.has(name.toLowerCase())) return name;
  }
  base = base.slice(0, LIMITS.maxName - 5);
  return `${base} ${Math.floor(Math.random() * 9000 + 1000)}`;
}

export function sanitizeCustomWords(input: unknown): string[] {
  const raw: unknown[] = Array.isArray(input) ? input : typeof input === "string" ? input.split("\n") : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const w = sanitizeText(item);
    if (!w || seen.has(w.toLowerCase())) continue;
    seen.add(w.toLowerCase());
    out.push(w);
    if (out.length >= LIMITS.maxCustomWords) break;
  }
  return out;
}

const COLOUR_RE = /^#[0-9a-fA-F]{6}$/;
const TOOLS: Tool[] = ["pen", "eraser", "fill"];

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

/** Clean up strokes from a client: valid tools/colours, clamped sizes + coordinates, size limits. */
export function sanitizeStrokes(input: unknown): Stroke[] {
  if (!Array.isArray(input)) return [];
  const out: Stroke[] = [];
  let totalPoints = 0;
  for (const raw of input) {
    if (out.length >= LIMITS.maxStrokes || totalPoints >= LIMITS.maxPoints) break;
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (!TOOLS.includes(r.tool as Tool)) continue;
    if (typeof r.colour !== "string" || !COLOUR_RE.test(r.colour)) continue;
    if (!Array.isArray(r.points)) continue;
    const size = clamp(Math.round(Number(r.size) || 0), LIMITS.minStrokeSize, LIMITS.maxStrokeSize);
    const points: Point[] = [];
    for (const p of r.points as unknown[]) {
      if (totalPoints + points.length >= LIMITS.maxPoints) break;
      if (!Array.isArray(p) || p.length < 2) continue;
      const x = Number(p[0]);
      const y = Number(p[1]);
      const ms = Number(p[2] ?? 0);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      points.push([
        clamp(Math.round(x), 0, CANVAS_W),
        clamp(Math.round(y), 0, CANVAS_H),
        Number.isFinite(ms) ? clamp(Math.round(ms), 0, 3_600_000) : 0,
      ]);
      if (r.tool === "fill") break; // a fill has exactly one point
    }
    if (!points.length) continue;
    totalPoints += points.length;
    out.push({ tool: r.tool as Tool, colour: r.colour.toLowerCase(), size, points });
  }
  return out;
}
