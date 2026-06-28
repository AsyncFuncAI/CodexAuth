/**
 * Framework-neutral implementation of the /api/codex/* contract.
 *
 * Operates on Web-standard `Request`/`Response` so it works in Next.js route
 * handlers, Cloudflare Workers (as a proxy target), Bun, Deno, etc. The Express
 * adapter wraps this too. All security hardening (cookie attrs, CSRF, CORS,
 * token confinement) lives here so every adapter inherits it.
 */
import { sign, unsign } from "cookie-signature";
import type { CodexRunner, SessionCtx } from "../types.js";
import { createMemorySessionStore, type SessionStore } from "./sessionStore.js";

export interface CodexHandlerOptions {
  runner: CodexRunner;
  cookieSecret: string;
  sessionStore?: SessionStore;
  cookieName?: string;
  cookieOptions?: Partial<CookieAttributes>;
  allowedOrigins?: string[];
  /** Path prefix the routes live under. Default "/api/codex". */
  basePath?: string;
}

export interface CookieAttributes {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
  path: string;
  maxAge: number;
}

const DEFAULT_COOKIE_NAME = "codex_sid";
const DEFAULT_BASE_PATH = "/api/codex";

interface Resolved {
  store: SessionStore;
  cookieName: string;
  cookieAttrs: CookieAttributes;
  basePath: string;
}

const resolvedCache = new WeakMap<CodexHandlerOptions, Resolved>();

function resolve(opts: CodexHandlerOptions): Resolved {
  let r = resolvedCache.get(opts);
  if (r) return r;
  if (!opts.cookieSecret || opts.cookieSecret.length < 16) {
    throw new Error(
      "codex-auth: cookieSecret must be a high-entropy string (>=16 chars), sourced from env.",
    );
  }
  r = {
    store: opts.sessionStore ?? createMemorySessionStore(),
    cookieName: opts.cookieName ?? DEFAULT_COOKIE_NAME,
    cookieAttrs: {
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
      path: "/",
      maxAge: 24 * 60 * 60,
      ...opts.cookieOptions,
    },
    basePath: (opts.basePath ?? DEFAULT_BASE_PATH).replace(/\/+$/, ""),
  };
  resolvedCache.set(opts, r);
  return r;
}

function cookieHeader(name: string, value: string, attrs: CookieAttributes): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${attrs.path}`,
    `Max-Age=${attrs.maxAge}`,
    attrs.httpOnly ? "HttpOnly" : "",
    attrs.secure ? "Secure" : "",
    `SameSite=${attrs.sameSite}`,
  ]
    .filter(Boolean)
    .join("; ");
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

function getSession(req: Request, r: Resolved, secret: string): SessionCtx | undefined {
  const raw = readCookie(req, r.cookieName);
  if (!raw) return undefined;
  const unsigned = unsign(raw, secret);
  if (unsigned === false) return undefined;
  return r.store.get(unsigned);
}

/** CSRF: require same-origin via Sec-Fetch-Site, with an Origin/Host fallback. */
function csrfRejected(req: Request, allowedOrigins?: string[]): boolean {
  const sfs = req.headers.get("sec-fetch-site");
  if (sfs) {
    if (sfs === "same-origin" || sfs === "none") return false;
    const origin = req.headers.get("origin");
    return !(origin && allowedOrigins?.includes(origin));
  }
  const origin = req.headers.get("origin");
  if (!origin) return false; // same-origin navigations often omit Origin
  try {
    const host = req.headers.get("host");
    if (new URL(origin).host === host) return false;
  } catch {
    /* fall through */
  }
  return !allowedOrigins?.includes(origin);
}

function corsHeaders(req: Request, allowedOrigins?: string[]): Record<string, string> {
  const origin = req.headers.get("origin");
  if (origin && allowedOrigins?.includes(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
      Vary: "Origin",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
    };
  }
  return {};
}

function json(body: unknown, init: ResponseInit = {}, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers as object), ...extra },
  });
}

/** Handle one request against the contract. Returns a Web Response. */
export async function handleCodexRequest(
  req: Request,
  opts: CodexHandlerOptions,
): Promise<Response> {
  const r = resolve(opts);
  const url = new URL(req.url);
  const path = url.pathname.startsWith(r.basePath)
    ? url.pathname.slice(r.basePath.length) || "/"
    : url.pathname;
  const cors = corsHeaders(req, opts.allowedOrigins);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  const post = req.method === "POST";
  // CSRF on all state-changing routes.
  if (post && csrfRejected(req, opts.allowedOrigins)) {
    return json({ error: "cross-origin request rejected" }, { status: 403 }, cors);
  }

  // POST /session
  if (post && path === "/session") {
    const existing = getSession(req, r, opts.cookieSecret);
    if (existing) return json({ ok: true }, {}, cors);
    const ctx = r.store.create();
    return json(
      { ok: true },
      {},
      { ...cors, "set-cookie": cookieHeader(r.cookieName, sign(ctx.id, opts.cookieSecret), r.cookieAttrs) },
    );
  }

  // POST /login/start
  if (post && path === "/login/start") {
    const ctx = getSession(req, r, opts.cookieSecret);
    if (!ctx) return json({ error: "no session" }, { status: 401 }, cors);
    try {
      const result = await opts.runner.startDeviceLogin(ctx);
      if ("loggedIn" in result) {
        const rotated = r.store.rotate(ctx.id);
        const extra: Record<string, string> = { ...cors };
        if (rotated) {
          extra["set-cookie"] = cookieHeader(
            r.cookieName,
            sign(rotated.id, opts.cookieSecret),
            r.cookieAttrs,
          );
        }
        return json({ ok: true, loggedIn: true }, {}, extra);
      }
      if ("errorCode" in result) return json({ errorCode: result.errorCode }, {}, cors);
      return json(
        { loginUrl: result.loginUrl, userCode: result.userCode, expiresAt: result.expiresAt },
        {},
        cors,
      );
    } catch {
      return json({ error: "could not start login" }, { status: 500 }, cors);
    }
  }

  // GET /status
  if (!post && path === "/status") {
    const ctx = getSession(req, r, opts.cookieSecret);
    if (!ctx) return json({ ok: false, status: "logged_out" }, { status: 401 }, cors);
    try {
      const result = await opts.runner.getStatus(ctx);
      if (!result.ok) {
        return json({ ok: false, status: result.status ?? "pending" }, {}, cors);
      }
      // Mark the session authenticated and rotate the id on the FIRST transition
      // from unauthenticated to authenticated (session-fixation defense — an
      // attacker who planted a known cookie cannot ride the victim's login).
      const extra: Record<string, string> = { ...cors };
      if (!ctx.data.authenticated) {
        ctx.data.authenticated = true;
        const rotated = r.store.rotate(ctx.id);
        if (rotated) {
          extra["set-cookie"] = cookieHeader(
            r.cookieName,
            sign(rotated.id, opts.cookieSecret),
            r.cookieAttrs,
          );
        }
      }
      return json({ ok: true, account: result.account }, {}, extra);
    } catch {
      return json({ ok: false, status: "error" }, { status: 503 }, cors);
    }
  }

  // POST /run/stream
  if (post && path === "/run/stream") {
    const ctx = getSession(req, r, opts.cookieSecret);
    if (!ctx) return json({ error: "no session" }, { status: 401 }, cors);
    // Require an AUTHENTICATED session — a bare cookie holder must not be able to
    // burn the logged-in account's quota.
    if (!ctx.data.authenticated) {
      try {
        const status = await opts.runner.getStatus(ctx);
        if (!status.ok) return json({ error: "not authenticated" }, { status: 401 }, cors);
        ctx.data.authenticated = true;
      } catch {
        return json({ error: "not authenticated" }, { status: 401 }, cors);
      }
    }
    // One in-flight run per session (basic quota-abuse guard).
    if (ctx.data.runInFlight) {
      return json({ error: "a run is already in progress" }, { status: 429 }, cors);
    }
    let prompt = "";
    try {
      prompt = ((await req.json()) as { prompt?: string }).prompt ?? "";
    } catch {
      /* empty */
    }
    if (!prompt.trim()) return json({ error: "prompt is required" }, { status: 400 }, cors);

    ctx.data.runInFlight = true;
    const ac = new AbortController();
    req.signal?.addEventListener("abort", () => ac.abort(), { once: true });

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enc = new TextEncoder();
        try {
          for await (const event of opts.runner.run(ctx, prompt, ac.signal)) {
            controller.enqueue(enc.encode(JSON.stringify(event) + "\n"));
          }
        } catch {
          controller.enqueue(enc.encode(JSON.stringify({ type: "error", error: "run failed" }) + "\n"));
        } finally {
          ctx.data.runInFlight = false;
          controller.close();
        }
      },
      cancel() {
        ctx.data.runInFlight = false;
        ac.abort();
      },
    });
    return new Response(stream, {
      headers: { "content-type": "application/x-ndjson", "cache-control": "no-cache", ...cors },
    });
  }

  // POST /logout
  if (post && path === "/logout") {
    const ctx = getSession(req, r, opts.cookieSecret);
    if (ctx) {
      try {
        await opts.runner.logout(ctx);
      } catch {
        /* best effort */
      }
      r.store.delete(ctx.id);
    }
    // Clear the cookie using the SAME attributes it was set with (so it actually
    // clears in dev where Secure is off, and honors a custom Path/SameSite).
    return json(
      {},
      {},
      { ...cors, "set-cookie": cookieHeader(r.cookieName, "", { ...r.cookieAttrs, maxAge: 0 }) },
    );
  }

  return json({ error: "not found" }, { status: 404 }, cors);
}
