// Where the game server is. Normally the same site that serves the page
// (Cloudflare). When the website is hosted elsewhere (e.g. Vercel), the build
// sets VITE_GAME_SERVER to the Cloudflare address, like
// https://doodle-chain.yourname.workers.dev

const configured = (import.meta.env.VITE_GAME_SERVER ?? "").trim().replace(/\/+$/, "");

export const SERVER_ORIGIN = configured || location.origin;

export function apiUrl(path: string): string {
  return new URL(path, SERVER_ORIGIN).toString();
}

export function wsUrl(path: string): string {
  const u = new URL(path, SERVER_ORIGIN);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.toString();
}
