// Builds the Vercel version into .vercel/output (Vercel's "Build Output API"):
//   static/                 the website (React app)
//   functions/api/game.func the game server (one Node.js function)
//   config.json             routing: /api/* → game server, everything else → the app
import { build as viteBuild } from "vite";
import { build as esbuild } from "esbuild";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";

const OUT = ".vercel/output";
// Run the game server close to the players. sin1 = Singapore (good for Malaysia).
const REGION = process.env.GAME_REGION || "sin1";

rmSync(OUT, { recursive: true, force: true });

// 1. Website
await viteBuild({ mode: "vercel", logLevel: "warn" });
mkdirSync(`${OUT}/static`, { recursive: true });
cpSync("dist/vercel", `${OUT}/static`, { recursive: true });

// 2. Game server function
const fn = `${OUT}/functions/api/game.func`;
mkdirSync(fn, { recursive: true });
await esbuild({
  entryPoints: ["server/vercel-function.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: `${fn}/index.mjs`,
  logLevel: "warning",
});
writeFileSync(
  `${fn}/.vc-config.json`,
  JSON.stringify(
    {
      runtime: "nodejs22.x",
      handler: "index.mjs",
      launcherType: "Nodejs",
      shouldAddHelpers: false,
      maxDuration: 15,
      regions: [REGION],
    },
    null,
    2,
  ),
);

// 3. Routing
writeFileSync(
  `${OUT}/config.json`,
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: "^/assets/(.*)$", headers: { "cache-control": "public, max-age=31536000, immutable" }, continue: true },
        { src: "^/api/new/?$", dest: "/api/game?route=new" },
        { src: "^/api/room/([A-Za-z]{4})/?$", dest: "/api/game?code=$1" },
        { src: "^/api/(?!game$).*", dest: "/api/game?route=missing" },
        { handle: "filesystem" },
        { src: "^/(.*)$", dest: "/index.html" },
      ],
    },
    null,
    2,
  ),
);
console.log(`Built the Vercel version into ${OUT} (game server region: ${REGION}).`);
