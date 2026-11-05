// Node HTTP glue for the Vercel game server (also used by `npm run dev:vercel`).
//   GET  /api/new          → { code }
//   POST /api/room/<CODE>  → check-in (see server/game.ts)

import type { IncomingMessage, ServerResponse } from "node:http";
import { handleRoom, newRoomCode, type PollRequest } from "./game";
import type { Store } from "./kv";

const MAX_BODY = 2_000_000;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("too big"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: string) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(body);
}

export async function handleHttp(req: IncomingMessage, res: ServerResponse, store: Store | null): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  // Vercel passes the room code as ?code= after its rewrite; locally it's in the path.
  const pathCode = url.pathname.match(/^\/api\/room\/([A-Za-z]{4})\/?$/)?.[1];
  const code = (url.searchParams.get("code") ?? pathCode ?? "").toUpperCase();
  const isNew = url.searchParams.get("route") === "new" || url.pathname === "/api/new";

  if (!store) {
    return send(
      res,
      503,
      JSON.stringify({
        error: "The game database isn't connected yet. In Vercel: open the project → Storage → connect an Upstash Redis database, then redeploy.",
      }),
    );
  }
  try {
    if (isNew) {
      if (req.method !== "GET") return send(res, 405, JSON.stringify({ error: "Use GET" }));
      return send(res, 200, JSON.stringify({ code: await newRoomCode(store) }));
    }
    if (code) {
      if (req.method !== "POST") return send(res, 405, JSON.stringify({ error: "Use POST" }));
      let body: PollRequest = {};
      try {
        body = JSON.parse(await readBody(req)) as PollRequest;
      } catch {
        return send(res, 400, JSON.stringify({ error: "Bad request" }));
      }
      return send(res, 200, await handleRoom(store, code, body));
    }
    return send(res, 404, JSON.stringify({ error: "Not found" }));
  } catch (err) {
    console.error(err);
    return send(res, 500, JSON.stringify({ error: "Something went wrong on the server. Try again in a moment." }));
  }
}
