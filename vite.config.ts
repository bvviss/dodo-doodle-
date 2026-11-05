import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

/** Local stand-in for the Vercel game server (see server/dev.ts). */
function localVercelApi(): Plugin {
  return {
    name: "local-vercel-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/api/")) return next();
        server
          .ssrLoadModule("/server/dev.ts")
          .then((mod) => (mod as typeof import("./server/dev")).devHandler(req, res))
          .catch(next);
      });
    },
  };
}

// Build modes:
//  - normal (`npm run dev`, `npm run build`, `npm run deploy`): Cloudflare, website + game server together.
//  - "vercel" (`npm run dev:vercel`, `npm run build:vercel`): website + check-in game server for Vercel.
//  - "web" (`npm run build:web`): website only, talking to a Cloudflare game server at VITE_GAME_SERVER.
export default defineConfig(({ mode }) => {
  if (mode === "vercel") {
    return { plugins: [react(), localVercelApi()], build: { outDir: "dist/vercel" } };
  }
  if (mode === "web") {
    if (!process.env.VITE_GAME_SERVER) {
      throw new Error(
        "VITE_GAME_SERVER is not set. Set it to your Cloudflare game server address, e.g. https://doodle-chain.yourname.workers.dev",
      );
    }
    return { plugins: [react()], build: { outDir: "dist/web" } };
  }
  return { plugins: [react(), cloudflare()] };
});
