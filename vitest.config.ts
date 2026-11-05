// Separate from vite.config.ts on purpose: the Cloudflare plugin breaks Vitest.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
