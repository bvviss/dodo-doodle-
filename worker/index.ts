// Cloudflare Worker entry point.
//  - GET /api/new               → { code } a fresh 4-letter room code
//  - GET /api/room/<CODE>/ws    → WebSocket into that room's Durable Object
// Everything else is the React app, served as static assets by Cloudflare.

import { DurableObject } from "cloudflare:workers";
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, ROOM_CODE_RE, type ServerMsg } from "../shared/types";
import { GameRoom, type Connection, type RoomDeps } from "./room";

interface Env {
  ROOMS: DurableObjectNamespace<RoomDurableObject>;
}

/** Biggest WebSocket message we accept (a big drawing is ~500 KB). */
const MAX_MESSAGE_BYTES = 1_000_000;

function randomCode(): string {
  const bytes = new Uint8Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => ROOM_CODE_ALPHABET[b % ROOM_CODE_ALPHABET.length]).join("");
}

// The website may be hosted somewhere else (e.g. Vercel) and call this server
// from there, so API answers allow other sites to read them. Nothing here is private.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === "/api/new") {
      // Try a few codes and pick one that isn't in use.
      for (let i = 0; i < 5; i++) {
        const code = randomCode();
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        const info = await stub.info();
        if (info.players === 0) return json({ code });
      }
      return json({ code: randomCode() });
    }

    const m = url.pathname.match(/^\/api\/room\/([A-Za-z]{4})\/ws$/);
    if (m) {
      const code = m[1].toUpperCase();
      if (!ROOM_CODE_RE.test(code)) return json({ error: "Bad room code" }, 400);
      if (request.headers.get("Upgrade") !== "websocket") return json({ error: "Expected a WebSocket" }, 426);
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      const forward = new Request(`https://room/${code}`, request);
      return stub.fetch(forward);
    }

    return json({ error: "Not found" }, 404);
  },
} satisfies ExportedHandler<Env>;

/**
 * One instance per room code. Holds the GameRoom in memory and keeps plain
 * WebSockets open (the room stays awake while players are connected).
 */
export class RoomDurableObject extends DurableObject<Env> {
  private room: GameRoom | null = null;

  private deps: RoomDeps = {
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, Math.max(0, ms)),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    random: () => Math.random(),
    makeId: () => crypto.randomUUID().replace(/-/g, "").slice(0, 12),
  };

  private getRoom(code: string): GameRoom {
    if (!this.room) this.room = new GameRoom(code, this.deps);
    return this.room;
  }

  /** Used by /api/new to avoid handing out a code that's in use. */
  async info(): Promise<{ players: number }> {
    return { players: this.room?.playerCount ?? 0 };
  }

  async fetch(request: Request): Promise<Response> {
    const code = new URL(request.url).pathname.slice(1);
    const room = this.getRoom(code);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    let open = true;
    const conn: Connection = {
      send(msg: ServerMsg) {
        if (!open) return;
        try {
          server.send(JSON.stringify(msg));
        } catch {
          open = false;
        }
      },
      close() {
        if (!open) return;
        open = false;
        try {
          server.close(1000, "bye");
        } catch {
          /* already closed */
        }
      },
    };

    room.connect(conn);
    server.addEventListener("message", (event) => {
      const data = event.data;
      if (typeof data !== "string" || data.length > MAX_MESSAGE_BYTES) return;
      try {
        room.message(conn, data);
      } catch (err) {
        console.error("room error", err);
      }
    });
    const onClose = () => {
      open = false;
      room.disconnect(conn);
    };
    server.addEventListener("close", onClose);
    server.addEventListener("error", onClose);

    return new Response(null, { status: 101, webSocket: client });
  }
}
