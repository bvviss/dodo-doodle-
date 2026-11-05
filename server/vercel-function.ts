// Entry point of the Vercel Function (bundled by scripts/build-vercel.mjs).
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleHttp } from "./http";
import { storeFromEnv } from "./kv";

const store = storeFromEnv(process.env);

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return handleHttp(req, res, store);
}
