// Standalone production backend for codex-auth.
// Mounts createCodexRouter at /api/codex and serves it on $PORT.
//
// Required env:  COOKIE_SECRET   (high-entropy, e.g. `openssl rand -base64 32`)
// Optional env:  PORT (default 8787), CODEX_MODEL (default gpt-5.5),
//                ALLOWED_ORIGINS (comma-separated, for cross-origin frontends)

import express from "express";
import { createCodexRouter, defaultCliRunner } from "codex-auth/backend";

const PORT = Number(process.env.PORT ?? 8787);
const COOKIE_SECRET = process.env.COOKIE_SECRET;
const MODEL = process.env.CODEX_MODEL ?? "gpt-5.5";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!COOKIE_SECRET || COOKIE_SECRET.length < 16) {
  console.error("FATAL: set COOKIE_SECRET to a high-entropy string (>=16 chars).");
  process.exit(1);
}

const app = express();

// Basic liveness probe for the host's health checks.
app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.use(
  "/api/codex",
  createCodexRouter({
    runner: defaultCliRunner({ model: MODEL }),
    cookieSecret: COOKIE_SECRET,
    ...(ALLOWED_ORIGINS.length ? { allowedOrigins: ALLOWED_ORIGINS } : {}),
  }),
);

app.listen(PORT, () => {
  console.log(`[codex-auth] backend listening on :${PORT} (model: ${MODEL})`);
  if (ALLOWED_ORIGINS.length) console.log(`[codex-auth] allowed origins: ${ALLOWED_ORIGINS.join(", ")}`);
});
