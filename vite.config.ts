import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

// Two ways to build:
//  - normal (`npm run build` / `npm run deploy`): website + game server together for Cloudflare.
//  - website only (`npm run build:web`, used by Vercel): just the website, which talks to the
//    game server on Cloudflare at the address in VITE_GAME_SERVER.
export default defineConfig(({ mode }) => {
  const webOnly = mode === "web";
  if (webOnly && !process.env.VITE_GAME_SERVER) {
    throw new Error(
      "VITE_GAME_SERVER is not set. Set it to your Cloudflare game server address, " +
        "e.g. https://doodle-chain.yourname.workers.dev (in Vercel: Project → Settings → Environment Variables).",
    );
  }
  return {
    plugins: webOnly ? [react()] : [react(), cloudflare()],
    build: webOnly ? { outDir: "dist/web" } : undefined,
  };
});
