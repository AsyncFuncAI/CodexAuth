import express from "express";
import { createCodexRouter, defaultCliRunner } from "../../src/backend/index.js";

const PORT = Number(process.env.DEMO_SERVER_PORT ?? 8787);
const COOKIE_SECRET = process.env.COOKIE_SECRET ?? "dev-only-insecure-secret-change-me-please";

const app = express();

app.use(
  "/api/codex",
  createCodexRouter({
    runner: defaultCliRunner({ codexBin: process.env.CODEX_BIN ?? "codex" }),
    cookieSecret: COOKIE_SECRET,
    // The Vite dev server proxies same-origin over http, so Secure cookies would
    // not round-trip in local dev. Production should keep the default (Secure on).
    cookieOptions: { secure: false },
  }),
);

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[codex-auth demo] backend listening on http://localhost:${PORT}`);
  console.log(`[codex-auth demo] open the Vite app at http://localhost:5173`);
});
