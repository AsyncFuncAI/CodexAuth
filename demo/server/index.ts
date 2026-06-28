import express from "express";
import {
  createCodexRouter,
  createMemorySessionStore,
  defaultCliRunner,
  killLoginProc,
} from "../../src/backend/index.js";
import { directRunner } from "../../src/backend/direct/index.js";

const PORT = Number(process.env.DEMO_SERVER_PORT ?? 8787);
const COOKIE_SECRET = process.env.COOKIE_SECRET ?? "dev-only-insecure-secret-change-me-please";

// CODEX_RUNNER=cli uses the codex binary; default is the serverless-friendly
// directRunner (pure HTTP, no CLI needed).
const useCli = process.env.CODEX_RUNNER === "cli";

const app = express();

app.use(
  "/api/codex",
  createCodexRouter({
    runner: useCli
      ? defaultCliRunner({ codexBin: process.env.CODEX_BIN ?? "codex", model: process.env.CODEX_MODEL })
      : directRunner({ models: process.env.CODEX_MODEL ? [process.env.CODEX_MODEL] : undefined }),
    // The CLI runner needs its device-login process reaped; harmless for direct.
    sessionStore: createMemorySessionStore({ onEvict: killLoginProc }),
    cookieSecret: COOKIE_SECRET,
    // The Vite dev server proxies same-origin over http, so Secure cookies would
    // not round-trip in local dev. Production should keep the default (Secure on).
    cookieOptions: { secure: false },
  }),
);

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[codex-auth demo] backend listening on http://localhost:${PORT} (runner: ${useCli ? "cli" : "direct"})`);
  console.log(`[codex-auth demo] open the Vite app at http://localhost:5173`);
});
