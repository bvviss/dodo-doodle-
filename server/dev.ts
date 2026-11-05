// Used only by `npm run dev:vercel`: the Vercel game server running inside the
// local dev server, with an in-memory database (or a real Upstash one if the
// KV_REST_API_URL / KV_REST_API_TOKEN settings are present).
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleHttp } from "./http";
import { MemoryStore, storeFromEnv } from "./kv";

const store = storeFromEnv(process.env) ?? new MemoryStore();

export function devHandler(req: IncomingMessage, res: ServerResponse) {
  return handleHttp(req, res, store);
}
