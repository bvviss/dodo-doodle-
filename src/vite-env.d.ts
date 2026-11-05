/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Where the game server lives, e.g. https://doodle-chain.yourname.workers.dev. Empty = same site. */
  readonly VITE_GAME_SERVER?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
