// Shared types, constants and the WebSocket message protocol.
// Used by BOTH the browser and the server. No DOM, no Cloudflare APIs here.

// ---------------------------------------------------------------- constants

export const CANVAS_W = 800;
export const CANVAS_H = 600;

export const LIMITS = {
  minPlayers: 3,
  maxPlayers: 10,
  maxStrokes: 3000,
  maxPoints: 30000,
  maxText: 60,
  maxName: 16,
  maxCustomWords: 500,
  maxCallLink: 300,
  minStrokeSize: 1,
  maxStrokeSize: 80,
} as const;

/** Letters used for room codes: no vowels (no accidental words) and no look-alikes. */
export const ROOM_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
export const ROOM_CODE_LENGTH = 4;
export const ROOM_CODE_RE = /^[BCDFGHJKLMNPQRSTVWXZ]{4}$/;

/** Extra time the server waits after a deadline before filling in missing answers. */
export const GRACE_MS = 2000;
/** How often the browser sends an autosave of the drawing in progress. */
export const AUTOSAVE_MS = 5000;
/** How long the modifier banner shows before drawing starts. */
export const MODIFIER_BANNER_MS = 3000;
/** Minimum time between two reactions from the same player. */
export const REACTION_COOLDOWN_MS = 300;
/** Free prompt re-rolls per player per game. */
export const REROLLS_PER_GAME = 1;

/** Avatar colours players pick from. */
export const PLAYER_COLOURS = [
  "#ff4d4d", // red
  "#ff9f1c", // orange
  "#ffd23f", // yellow
  "#3bceac", // teal
  "#0ead69", // green
  "#3a86ff", // blue
  "#8338ec", // purple
  "#ff70a6", // pink
] as const;

/** Drawing palette (16 colours). First is black, second is white. */
export const PALETTE = [
  "#1b1b1b", "#ffffff", "#8a8a8a", "#d1d1d1",
  "#e63946", "#ff8fab", "#f77f00", "#fcbf49",
  "#ffe066", "#8ac926", "#2a9d8f", "#3a86ff",
  "#1d3557", "#7b2cbf", "#8d5524", "#f1c27d",
] as const;

export const PEN_SIZES = [4, 8, 16, 28] as const;
export const ERASER_COLOUR = "#ffffff";

export const REACTIONS = ["😂", "😮", "👏", "💀", "❤️", "🤔"] as const;
export type Reaction = (typeof REACTIONS)[number];

// ---------------------------------------------------------------- drawing

/** [x, y, ms since the drawing began]. x/y are integers on the 800×600 grid. */
export type Point = [number, number, number];
export type Tool = "pen" | "eraser" | "fill";

export interface Stroke {
  tool: Tool;
  colour: string;
  size: number;
  points: Point[];
}

// ---------------------------------------------------------------- settings

export type PromptSource = "player" | "packs" | "custom" | "mix";
export type Difficulty = "easy" | "medium" | "hard";
export type PackId = "animals" | "food" | "objects" | "actions" | "places" | "jobs" | "silly";
export type ModifierMode = "off" | "random";

export const PROMPT_TIMES = [30, 45, 60] as const;
/** 600 = "no limit". */
export const DRAW_TIMES = [45, 75, 120, 600] as const;
export const GUESS_TIMES = [25, 40, 60] as const;
/** 0 = full circle. */
export const CHAIN_LENGTHS = [0, 5, 7] as const;
export const NO_LIMIT_DRAW_TIME = 600;

export interface Settings {
  promptSource: PromptSource;
  packs: PackId[];
  difficulty: Difficulty;
  promptTime: (typeof PROMPT_TIMES)[number];
  drawTime: (typeof DRAW_TIMES)[number];
  guessTime: (typeof GUESS_TIMES)[number];
  chainLength: (typeof CHAIN_LENGTHS)[number];
  modifiers: ModifierMode;
  /** Optional voice/video call link (must start with https://). */
  callLink: string;
}

// ---------------------------------------------------------------- modifiers

export type ModifierId = "speed" | "threeColours" | "noUndo";

/** What a modifier changes on the drawing canvas. Add flags here for new modifiers. */
export interface CanvasFlags {
  /** Restrict the palette to these colours. */
  palette?: string[];
  /** Disable undo, redo, eraser and clear. */
  noUndo?: boolean;
}

/** The modifier active on a draw turn (same for everyone that turn). */
export interface ActiveModifier {
  id: ModifierId;
  name: string;
  description: string;
  emoji: string;
  canvas: CanvasFlags;
  /** Overrides the draw timer (seconds). */
  drawTime?: number;
}

// ---------------------------------------------------------------- game data

export type Phase = "lobby" | "prompt" | "draw" | "guess" | "reveal" | "scores";
export type TurnKind = "prompt" | "draw" | "guess";
export type Match = "exact" | "close" | "miss";

export interface PromptStep {
  kind: "prompt";
  authorId: string;
  authorName: string;
  text: string;
}
export interface DrawingStep {
  kind: "drawing";
  authorId: string;
  authorName: string;
  strokes: Stroke[];
}
export interface GuessStep {
  kind: "guess";
  authorId: string;
  authorName: string;
  text: string;
  /** Result of automatic text matching against the phrase the drawer was given. */
  autoMatch: Match;
  /** Final result after "close enough" votes. */
  match: Match;
  /** Player ids who voted "close enough". */
  votes: string[];
}
export type Step = PromptStep | DrawingStep | GuessStep;

/** A player's personal task for the current turn. */
export type Task =
  | { kind: "prompt"; dealt: string | null; rerollsLeft: number }
  | {
      kind: "draw";
      phrase: string;
      modifier: ActiveModifier | null;
      /** Server time when drawing may start (after the modifier banner). */
      startsAt: number;
      /** Last autosave, sent back after a reconnect so the drawing isn't lost. */
      draft?: Stroke[];
    }
  | { kind: "guess"; strokes: Stroke[] };

export interface PublicPlayer {
  id: string;
  name: string;
  colour: string;
  isBot: boolean;
  connected: boolean;
  score: number;
  /** Has submitted this turn. */
  done: boolean;
}

export interface RevealPointer {
  /** Chain currently being revealed. */
  chain: number;
  /** Index of the last revealed step in that chain. */
  step: number;
  chainCount: number;
  chainLength: number;
  /** Owner (starter) of every chain, by chain index. */
  owners: string[];
}

export interface RevealMatch {
  step: number;
  autoMatch: Match;
  match: Match;
  votes: string[];
}

export interface ScoreLine {
  playerId: string;
  points: number;
  exact: number;
  close: number;
  chainBonus: number;
}

export interface PublicRoom {
  code: string;
  hostId: string | null;
  phase: Phase;
  /** Current turn (0 = write prompt). */
  turn: number;
  totalTurns: number;
  /** Server time when the current turn's countdown hits zero. */
  deadline: number | null;
  settings: Settings;
  customWordCount: number;
  players: PublicPlayer[];
  /** Modifier for the current draw turn. */
  modifier: ActiveModifier | null;
  reveal: RevealPointer | null;
  /** Matches + votes for the guesses revealed so far in the current chain. */
  revealMatches: RevealMatch[];
  scores: ScoreLine[] | null;
}

export interface You {
  /**
   * Your task for this turn. To save bandwidth the server only includes it when
   * it changed (`taskSeq` went up) or after you (re)join; otherwise it's omitted.
   */
  task?: Task | null;
  taskSeq: number;
  submitted: boolean;
}

// ---------------------------------------------------------------- protocol

export type ClientMsg =
  | { type: "join"; name: string; colour: string; token?: string }
  | { type: "settings"; settings: Partial<Settings>; customWords?: string[] }
  | { type: "start" }
  | { type: "kick"; playerId: string }
  | { type: "addBot" }
  | { type: "removeBot" }
  | { type: "reroll" }
  | { type: "submit"; text?: string; strokes?: Stroke[] }
  | { type: "autosave"; strokes: Stroke[] }
  | { type: "revealNext" }
  | { type: "react"; emoji: string }
  | { type: "vote"; chain: number; step: number }
  | { type: "getChain"; chain: number }
  | { type: "playAgain" }
  | { type: "ping"; t: number };

export type ErrorCode = "in_progress" | "full" | "kicked" | "gone" | "bad_request" | "not_allowed";

export type ServerMsg =
  | { type: "welcome"; playerId: string; token: string }
  | { type: "state"; room: PublicRoom; you: You; serverNow: number }
  | { type: "revealData"; chainIndex: number; ownerId: string; fromStep: number; steps: Step[] }
  | { type: "chain"; chainIndex: number; ownerId: string; steps: Step[] }
  | { type: "reaction"; emoji: string; playerId: string; id?: number }
  | { type: "error"; message: string; code?: ErrorCode }
  | { type: "pong"; t: number; serverNow: number };
