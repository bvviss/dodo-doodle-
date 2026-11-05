// The Vercel game server. Vercel can't keep one live "referee" per room in
// memory, so every request does this:
//   1. lock the room, load it from the database (Upstash Redis)
//   2. let the same GameRoom referee as on Cloudflare apply the player's actions
//      and any timers that ran out
//   3. save it, unlock, and answer with everything this player needs.
// Browsers check in every second or so. A check-in where nothing changed costs
// a single tiny database round trip ("cheap path").
//
// Drawings are big, so they're stored in their own keys (by content hash) and
// only loaded when they're actually sent to someone.

import { createHash, randomBytes } from "node:crypto";
import { ROOM_CODE_ALPHABET, ROOM_CODE_RE, type ClientMsg, type ServerMsg } from "../shared/types";
import { GameRoom, type Connection, type RoomDeps, type RoomSnapshot } from "../worker/room";
import type { Store } from "./kv";

/** Rooms and drawings are forgotten after this long without activity. */
const TTL_S = 6 * 60 * 60;
/** Even when nothing happens, re-check who's still here this often. */
export const SWEEP_MS = 5000;
const LOCK_MS = 5000;
const LOCK_WAIT_MS = 4000;
const MAX_MSGS = 20;
/** Keep each database request comfortably under Upstash's request size limit. */
const MAX_PIPELINE_BYTES = 700_000;

const key = {
  snap: (code: string) => `dc:${code}:s`,
  meta: (code: string) => `dc:${code}:m`,
  seen: (code: string) => `dc:${code}:seen`,
  lock: (code: string) => `dc:${code}:lock`,
  drawing: (hash: string) => `dc:d:${hash}`,
};

interface Meta {
  v: number;
  /** Server time when this room next needs attention (a timer or a presence check). */
  due: number;
}

export interface PollRequest {
  token?: string;
  /** Room version the browser last saw. */
  v?: number;
  taskSeq?: number;
  /** Reveal: chain the browser is showing, and how many of its steps it has. */
  rc?: number;
  rh?: number;
  /** Highest reaction id the browser has seen. */
  lr?: number;
  msgs?: unknown[];
}

export interface PollResponse {
  v: number;
  now: number;
  msgs: ServerMsg[];
  /** The room was busy; try again in a moment. */
  retry?: boolean;
}

export interface GameOptions {
  now?: () => number;
  random?: () => number;
}

function makeId(): string {
  return randomBytes(9).toString("base64url");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------- new room

export async function newRoomCode(store: Store): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const bytes = randomBytes(4);
    const code = [...bytes].map((b) => ROOM_CODE_ALPHABET[b % ROOM_CODE_ALPHABET.length]).join("");
    const [exists] = (await store.pipeline([["EXISTS", key.meta(code)]])) as number[];
    if (!exists) return code;
  }
  throw new Error("Couldn't find a free room code");
}

// ---------------------------------------------------------------- drawings

/** A loaded room uses empty placeholder arrays with a `$ref` for drawings not loaded yet. */
type RefArray = unknown[] & { $ref?: string };

function isStrokeList(v: unknown): v is unknown[] {
  if (!Array.isArray(v) || v.length === 0) return false;
  const first = v[0] as { tool?: unknown; points?: unknown } | null;
  return !!first && typeof first === "object" && typeof first.tool === "string" && Array.isArray(first.points);
}

/** Turn a saved room back into objects, with drawing placeholders. */
function revive(json: string): RoomSnapshot {
  return JSON.parse(json, (_k, value) => {
    if (value && typeof value === "object" && !Array.isArray(value) && typeof value.$s === "string" && Object.keys(value).length === 1) {
      return Object.assign([], { $ref: value.$s }) as RefArray;
    }
    return value;
  }) as RoomSnapshot;
}

/** Save a room: drawings are swapped for {$s: hash}; new ones are collected for writing. */
function serialize(snap: RoomSnapshot, newDrawings: Map<string, string>): string {
  return JSON.stringify(snap, (k, value) => {
    // Check-in times live in their own hash and change every second: leave them
    // out so a check-in alone doesn't count as "the room changed".
    if (k === "lastSeen" || k === "sentTaskSeq") return undefined;
    if (Array.isArray(value)) {
      const ref = (value as RefArray).$ref;
      if (typeof ref === "string") return { $s: ref };
      if (isStrokeList(value)) {
        const json = JSON.stringify(value);
        const hash = createHash("sha1").update(json).digest("hex");
        newDrawings.set(hash, json);
        return { $s: hash };
      }
    }
    return value;
  });
}

/** Turn outgoing messages into JSON, loading any drawing placeholders from the database. */
async function renderMessages(store: Store, msgs: ServerMsg[]): Promise<string> {
  const refs = new Set<string>();
  JSON.stringify(msgs, (_k, value) => {
    const ref = Array.isArray(value) ? (value as RefArray).$ref : undefined;
    if (typeof ref === "string") refs.add(ref);
    return value;
  });
  const loaded = new Map<string, unknown>();
  const list = [...refs];
  for (let i = 0; i < list.length; i += 20) {
    const chunk = list.slice(i, i + 20);
    const [values] = (await store.pipeline([["MGET", ...chunk.map(key.drawing)]])) as (string | null)[][];
    chunk.forEach((ref, j) => loaded.set(ref, values?.[j] ? JSON.parse(values[j]!) : []));
  }
  return JSON.stringify(msgs, (_k, value) => {
    const ref = Array.isArray(value) ? (value as RefArray).$ref : undefined;
    return typeof ref === "string" ? (loaded.get(ref) ?? []) : value;
  });
}

async function writeDrawings(store: Store, drawings: Map<string, string>): Promise<void> {
  let batch: (string | number)[][] = [];
  let size = 0;
  for (const [hash, json] of drawings) {
    if (size + json.length > MAX_PIPELINE_BYTES && batch.length) {
      await store.pipeline(batch);
      batch = [];
      size = 0;
    }
    batch.push(["SET", key.drawing(hash), json, "EX", TTL_S]);
    size += json.length;
  }
  if (batch.length) await store.pipeline(batch);
}

// ---------------------------------------------------------------- requests

function cleanMsgs(raw: unknown): ClientMsg[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m): m is ClientMsg => !!m && typeof m === "object" && typeof (m as { type?: unknown }).type === "string")
    .filter((m) => m.type !== "ping")
    .slice(0, MAX_MSGS);
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/**
 * Handle one check-in from a browser. Returns the response as a JSON string
 * (so big drawings are only stringified once).
 */
export async function handleRoom(store: Store, code: string, req: PollRequest, opts: GameOptions = {}): Promise<string> {
  const now = opts.now ?? Date.now;
  const random = opts.random ?? Math.random;
  if (!ROOM_CODE_RE.test(code)) {
    return JSON.stringify({ v: 0, now: now(), msgs: [{ type: "error", message: "That room code doesn't look right.", code: "bad_request" }] });
  }
  const msgs = cleanMsgs(req.msgs);
  const token = typeof req.token === "string" ? req.token.slice(0, 64) : "";

  // Cheap path: a plain check-in, and nothing changed since the browser's last look.
  if (!msgs.length && token) {
    const [, metaRaw] = (await store.pipeline([
      ["HSET", key.seen(code), token, now()],
      ["GET", key.meta(code)],
    ])) as [unknown, string | null];
    const meta = metaRaw ? (JSON.parse(metaRaw) as Meta) : null;
    if (!meta) {
      return JSON.stringify({ v: 0, now: now(), msgs: [{ type: "error", message: "This room has closed. Start a new one!", code: "gone" }] });
    }
    if (meta.v === req.v && now() < meta.due) return JSON.stringify({ v: meta.v, now: now(), msgs: [] });
  }

  // Full path: lock the room.
  const lockValue = makeId();
  const lockStart = now();
  for (;;) {
    const [ok] = await store.pipeline([["SET", key.lock(code), lockValue, "NX", "PX", LOCK_MS]]);
    if (ok) break;
    if (now() - lockStart > LOCK_WAIT_MS) return JSON.stringify({ v: num(req.v, 0), now: now(), msgs: [], retry: true });
    await sleep(40 + random() * 80);
  }

  try {
    const [snapRaw, seenFlat, metaRaw] = (await store.pipeline([
      ["GET", key.snap(code)],
      ["HGETALL", key.seen(code)],
      ["GET", key.meta(code)],
    ])) as [string | null, string[] | null, string | null];
    const oldMeta = metaRaw ? (JSON.parse(metaRaw) as Meta) : null;

    const deps: RoomDeps = {
      now,
      setTimer: () => null, // no live timers here: due timers run on the next request
      clearTimer: () => {},
      random,
      makeId,
    };
    const room = snapRaw ? GameRoom.fromSnapshot(code, deps, revive(snapRaw), "poll") : new GameRoom(code, deps, "poll");

    const seenFlatList = Array.isArray(seenFlat) ? seenFlat : [];
    for (let i = 0; i + 1 < seenFlatList.length; i += 2) {
      const pid = room.playerIdByToken(seenFlatList[i]);
      if (pid) room.seen(pid, Number(seenFlatList[i + 1]));
    }

    const out: ServerMsg[] = [];
    const conn: Connection = { send: (m) => out.push(m), close: () => {} };
    room.connect(conn);

    let pid = room.playerIdByToken(token);
    const joining = msgs.some((m) => m.type === "join");
    if (pid && !joining) {
      room.seen(pid, now());
      room.attach(conn, pid);
    }
    room.runDue();
    room.sweepPresence();

    for (const m of msgs) {
      if (m.type === "join") {
        room.message(conn, m);
        const welcome = out.find((x): x is Extract<ServerMsg, { type: "welcome" }> => x.type === "welcome");
        if (welcome) {
          pid = welcome.playerId;
          await store.pipeline([["HSET", key.seen(code), welcome.token, now()]]);
        }
      } else if (pid) {
        room.message(conn, m);
      }
    }

    if (!pid && !joining) {
      out.push({ type: "error", message: "You're no longer in this room.", code: "gone" });
    }
    if (pid) {
      room.catchUp(pid, {
        taskSeq: num(req.taskSeq, -1),
        revealChain: num(req.rc, -1),
        revealHave: num(req.rh, 0),
        lastReaction: num(req.lr, 0),
      });
    }
    room.detach(conn);

    // Save (only if something changed) and work out when the room next needs attention.
    let v = oldMeta?.v ?? 0;
    const hasRoom = room.playerCount > 0;
    if (hasRoom) {
      const drawings = new Map<string, string>();
      const json = serialize(room.toSnapshot(), drawings);
      const changed = json !== snapRaw;
      if (changed) v++;
      const due = Math.min(room.nextDue() ?? Infinity, now() + SWEEP_MS);
      const meta: Meta = { v, due };
      await writeDrawings(store, drawings);
      await store.pipeline([
        ...(changed ? [["SET", key.snap(code), json, "EX", TTL_S]] : [["EXPIRE", key.snap(code), TTL_S]]),
        ["SET", key.meta(code), JSON.stringify(meta), "EX", TTL_S],
        ["EXPIRE", key.seen(code), TTL_S],
      ]);
    } else if (snapRaw) {
      await store.pipeline([["DEL", key.snap(code), key.meta(code), key.seen(code)]]);
    }

    // Only the newest state matters.
    const lastState = out.map((m) => m.type).lastIndexOf("state");
    const final = out.filter((m, i) => m.type !== "state" || i === lastState);
    const body = await renderMessages(store, final);
    return `{"v":${v},"now":${now()},"msgs":${body}}`;
  } finally {
    await store.pipeline([["DEL", key.lock(code)]]).catch(() => {});
  }
}
