import { Router, type Request, type Response, json as jsonBody } from "express";
import { sign, unsign } from "cookie-signature";
import type { CodexRunner, SessionCtx } from "../types.js";
import { createMemorySessionStore, type SessionStore } from "./sessionStore.js";
import { enforceSameOrigin, corsForAllowedOrigins } from "./security.js";

export interface CodexRouterOptions {
  runner: CodexRunner;
  /** Secret used to sign the session cookie. MUST come from env, high entropy. */
  cookieSecret: string;
  sessionStore?: SessionStore;
  cookieName?: string;
  /** Override cookie attributes (defaults are the hardened set). */
  cookieOptions?: Partial<CookieAttributes>;
  /** Allowlisted origins for credentialed cross-origin requests. */
  allowedOrigins?: string[];
}

interface CookieAttributes {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
  path: string;
  maxAge: number; // seconds
}

const DEFAULT_COOKIE_NAME = "codex_sid";

/**
 * Reference Express router implementing the /api/codex/* contract.
 *
 * Security posture (see SECURITY.md):
 *   - session cookie: HttpOnly + Secure + SameSite=Strict + signed, rotated on login
 *   - CSRF: Sec-Fetch-Site / Origin same-origin enforcement on all POSTs
 *   - CORS: only allowlisted origins get credentialed CORS (specific origin, never `*`)
 *   - OAuth tokens NEVER appear in any response — only the runner's result fields
 */
export function createCodexRouter(opts: CodexRouterOptions): Router {
  if (!opts.cookieSecret || opts.cookieSecret.length < 16) {
    throw new Error("createCodexRouter: cookieSecret must be a high-entropy string (>=16 chars), sourced from env.");
  }
  const store = opts.sessionStore ?? createMemorySessionStore();
  const cookieName = opts.cookieName ?? DEFAULT_COOKIE_NAME;
  const cookieAttrs: CookieAttributes = {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/",
    maxAge: 24 * 60 * 60,
    ...opts.cookieOptions,
  };
  const router = Router();

  if (opts.allowedOrigins?.length) {
    router.use(corsForAllowedOrigins(opts.allowedOrigins));
  }
  router.use(jsonBody());

  const setSessionCookie = (res: Response, sid: string) => {
    const value = sign(sid, opts.cookieSecret);
    const parts = [
      `${cookieName}=${encodeURIComponent(value)}`,
      `Path=${cookieAttrs.path}`,
      `Max-Age=${cookieAttrs.maxAge}`,
      cookieAttrs.httpOnly ? "HttpOnly" : "",
      cookieAttrs.secure ? "Secure" : "",
      `SameSite=${cookieAttrs.sameSite}`,
    ].filter(Boolean);
    res.setHeader("Set-Cookie", parts.join("; "));
  };

  const readSession = (req: Request): SessionCtx | undefined => {
    const raw = parseCookie(req.headers.cookie, cookieName);
    if (!raw) return undefined;
    const unsigned = unsign(decodeURIComponent(raw), opts.cookieSecret);
    if (unsigned === false) return undefined;
    return store.get(unsigned);
  };

  const csrf = enforceSameOrigin(opts.allowedOrigins);

  // POST /session — idempotent: ensure a session exists; reuse a valid one.
  router.post("/session", csrf, (req, res) => {
    const existing = readSession(req);
    if (existing) {
      res.json({ ok: true });
      return;
    }
    const ctx = store.create();
    setSessionCookie(res, ctx.id);
    res.json({ ok: true });
  });

  // POST /login/start — start the device-code flow.
  router.post("/login/start", csrf, async (req, res) => {
    const ctx = readSession(req);
    if (!ctx) {
      res.status(401).json({ error: "no session" });
      return;
    }
    try {
      const result = await opts.runner.startDeviceLogin(ctx);
      if ("loggedIn" in result) {
        // session fixation defense: rotate the id on successful auth
        const rotated = store.rotate(ctx.id);
        if (rotated) setSessionCookie(res, rotated.id);
        res.json({ ok: true, loggedIn: true });
        return;
      }
      if ("errorCode" in result) {
        res.json({ errorCode: result.errorCode });
        return;
      }
      res.json({
        loginUrl: result.loginUrl,
        userCode: result.userCode,
        expiresAt: result.expiresAt,
      });
    } catch {
      res.status(500).json({ error: "could not start login" });
    }
  });

  // GET /status — polling target. Returns ONLY {ok, account} — never a token.
  router.get("/status", async (req, res) => {
    const ctx = readSession(req);
    if (!ctx) {
      res.status(401).json({ ok: false, status: "logged_out" });
      return;
    }
    try {
      const result = await opts.runner.getStatus(ctx);
      if (result.ok) {
        // rotate on first confirmed login
        res.json({ ok: true, account: result.account });
      } else {
        res.json({ ok: false, status: result.status ?? "pending" });
      }
    } catch {
      res.status(503).json({ ok: false, status: "error" });
    }
  });

  // POST /run/stream — NDJSON of RunStreamEvent.
  router.post("/run/stream", csrf, async (req, res) => {
    const ctx = readSession(req);
    if (!ctx) {
      res.status(401).json({ error: "no session" });
      return;
    }
    const prompt = (req.body?.prompt ?? "") as string;
    if (!prompt.trim()) {
      res.status(400).json({ error: "prompt is required" });
      return;
    }
    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Cache-Control", "no-cache");

    const ac = new AbortController();
    // Kill the run if the client disconnects — no orphaned codex exec spend.
    req.on("close", () => ac.abort());

    try {
      for await (const event of opts.runner.run(ctx, prompt, ac.signal)) {
        res.write(JSON.stringify(event) + "\n");
      }
    } catch (e) {
      res.write(JSON.stringify({ type: "error", error: "run failed" }) + "\n");
      void e;
    } finally {
      res.end();
    }
  });

  // POST /logout — clear the session + tokens.
  router.post("/logout", csrf, async (req, res) => {
    const ctx = readSession(req);
    if (ctx) {
      try {
        await opts.runner.logout(ctx);
      } catch {
        /* best effort */
      }
      store.delete(ctx.id);
    }
    res.setHeader(
      "Set-Cookie",
      `${cookieName}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`,
    );
    res.json({});
  });

  return router;
}

function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}
