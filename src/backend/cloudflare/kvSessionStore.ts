/**
 * Cloudflare KV-backed session handling for Workers.
 *
 * Workers are stateless across requests, so the in-memory session store does not
 * work — a session's tokens must persist in durable storage. This module wraps
 * `handleCodexRequest` to:
 *   1. load the session's `ctx.data` from KV (keyed by the signed cookie's id),
 *   2. run the handler against a one-request in-memory store seeded with it,
 *   3. flush the (possibly mutated) `ctx.data` back to KV with a TTL.
 *
 * Tokens live in KV (server-side), never in the browser. KV is eventually
 * consistent, but each session is a single key with a single writer per request,
 * so the device-login poll + run flow is safe in practice.
 */
import type { KVNamespace } from "@cloudflare/workers-types";
import type { SessionCtx } from "../types.js";
import type { SessionStore } from "../core/sessionStore.js";
import { handleCodexRequest, type CodexHandlerOptions } from "../core/handler.js";

const SESSION_TTL_SECONDS = 24 * 60 * 60; // 24h
const KEY_PREFIX = "codex-sess:";

function newId(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function readCookieId(req: Request, cookieName: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === cookieName) return decodeURIComponent(v.join("="));
    // The signed value (id.sig) is handled inside the handler; here we only need
    // a coarse presence — the handler verifies the signature.
  }
  return null;
}

/**
 * A SessionStore backed by an in-memory map seeded from KV for the current
 * request. `create`/`rotate`/`delete` are synchronous (the interface requires
 * it); the actual KV writes happen in `flush()` after the handler returns.
 */
class KvRequestStore implements SessionStore {
  private sessions = new Map<string, SessionCtx>();
  private dirty = new Set<string>();
  private deleted = new Set<string>();

  constructor(private kv: KVNamespace) {}

  /** Seed the store with a session's data loaded from KV. */
  seed(id: string, data: Record<string, unknown>): void {
    this.sessions.set(id, { id, data });
  }

  create(): SessionCtx {
    const id = newId();
    const ctx: SessionCtx = { id, data: {} };
    this.sessions.set(id, ctx);
    this.dirty.add(id);
    return ctx;
  }
  get(id: string): SessionCtx | undefined {
    return this.sessions.get(id);
  }
  delete(id: string): void {
    this.sessions.delete(id);
    this.deleted.add(id);
    this.dirty.delete(id);
  }
  rotate(id: string): SessionCtx | undefined {
    const existing = this.sessions.get(id);
    if (!existing) return undefined;
    this.sessions.delete(id);
    this.deleted.add(id); // remove the old key
    const nid = newId();
    existing.id = nid;
    this.sessions.set(nid, existing);
    this.dirty.add(nid);
    return existing;
  }

  /** Mark every live session dirty (the handler may have mutated ctx.data). */
  markAllDirty(): void {
    for (const id of this.sessions.keys()) this.dirty.add(id);
  }

  /** Persist mutations to KV. Call after the handler returns. */
  async flush(): Promise<void> {
    const ops: Promise<unknown>[] = [];
    for (const id of this.deleted) ops.push(this.kv.delete(KEY_PREFIX + id));
    for (const id of this.dirty) {
      const ctx = this.sessions.get(id);
      if (ctx) {
        // Never persist transient per-request flags — they belong to the
        // in-flight request, not durable session state. Persisting runInFlight
        // would wedge every future run with a 429.
        const { runInFlight, ...persisted } = ctx.data as Record<string, unknown>;
        void runInFlight;
        ops.push(
          this.kv.put(KEY_PREFIX + id, JSON.stringify(persisted), {
            expirationTtl: SESSION_TTL_SECONDS,
          }),
        );
      }
    }
    await Promise.all(ops);
  }
}

export interface KvHandlerOptions extends Omit<CodexHandlerOptions, "sessionStore"> {
  kv: KVNamespace;
}

/**
 * Handle one Worker request against the /api/codex/* contract, persisting the
 * session to KV. Drop-in for `handleCodexRequest` inside a Worker.
 */
export async function handleCodexRequestKV(
  req: Request,
  opts: KvHandlerOptions,
): Promise<Response> {
  const cookieName = opts.cookieName ?? "codex_sid";
  const store = new KvRequestStore(opts.kv);

  // Best-effort: if the request carries a session cookie, hydrate that session
  // from KV before the handler runs. The cookie value is `id.sig`; the handler
  // verifies the signature, but for hydration we just need the id prefix.
  const rawCookie = readCookieId(req, cookieName);
  if (rawCookie) {
    const id = rawCookie.split(".")[0]; // id portion of the signed cookie
    if (id) {
      const stored = await opts.kv.get(KEY_PREFIX + id, "json");
      if (stored && typeof stored === "object") {
        store.seed(id, stored as Record<string, unknown>);
      }
    }
  }

  const res = await handleCodexRequest(req, { ...opts, sessionStore: store });

  // The handler may have mutated ctx.data (tokens, device-login state) in place.
  store.markAllDirty();
  await store.flush();

  return res;
}
