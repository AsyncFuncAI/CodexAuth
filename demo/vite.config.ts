import { defineConfig } from "vite";

const SERVER_PORT = Number(process.env.DEMO_SERVER_PORT ?? 8787);

// The demo Vite app proxies /api/codex to the demo Express server so the whole
// flow runs end-to-end on one origin (which also keeps the cookie same-origin).
export default defineConfig({
  root: __dirname,
  resolve: {
    alias: {
      // Use the package source directly so the demo always tracks local changes.
      "codex-auth/backend": new URL("../src/backend/index.ts", import.meta.url).pathname,
      "codex-auth": new URL("../src/index.ts", import.meta.url).pathname,
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api/codex": `http://localhost:${SERVER_PORT}`,
    },
  },
});
