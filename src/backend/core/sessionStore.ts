import { randomBytes } from "node:crypto";
import type { SessionCtx } from "../types.js";

export interface SessionStore {
  create(): SessionCtx;
  get(id: string): SessionCtx | undefined;
  delete(id: string): void;
  /** Regenerate the id for an existing session (session-fixation defense on login). */
  rotate(id: string): SessionCtx | undefined;
}

export interface MemorySessionStoreOptions {
  ttlMs?: number;
  /**
   * Called when a session is reaped (TTL) or deleted, so the caller can release
   * session-owned resources — e.g. kill a lingering device-login child process.
   * Keeps the store free of any dependency on the CLI runner.
   */
  onEvict?: (ctx: SessionCtx) => void;
}

/**
 * In-memory session store. Holds the runner's server-side state (including any
 * OAuth tokens the runner keeps) keyed by an opaque id carried in a signed
 * HttpOnly cookie. NOTE: in-memory means a restart invalidates all sessions —
 * swap for a shared store (Redis, etc.) in production. Sessions TTL-expire.
 */
export function createMemorySessionStore(opts: MemorySessionStoreOptions = {}): SessionStore {
  const ttlMs = opts.ttlMs ?? 24 * 60 * 60 * 1000; // 24h
  const sessions = new Map<string, { ctx: SessionCtx; createdAt: number }>();

  const newId = () => randomBytes(24).toString("base64url");

  const evict = (id: string) => {
    const s = sessions.get(id);
    if (!s) return;
    sessions.delete(id);
    if (opts.onEvict) {
      try {
        opts.onEvict(s.ctx);
      } catch {
        /* disposer must never break eviction */
      }
    }
  };

  const reap = () => {
    const now = Date.now();
    for (const [id, s] of sessions) {
      if (now - s.createdAt > ttlMs) evict(id);
    }
  };

  return {
    create() {
      reap();
      const id = newId();
      const ctx: SessionCtx = { id, data: {} };
      sessions.set(id, { ctx, createdAt: Date.now() });
      return ctx;
    },
    get(id) {
      reap();
      return sessions.get(id)?.ctx;
    },
    delete(id) {
      // Explicit delete (logout) runs the evict disposer too.
      evict(id);
    },
    rotate(id) {
      const existing = sessions.get(id);
      if (!existing) return undefined;
      // Rotation keeps the same ctx (and its resources) — do NOT evict.
      sessions.delete(id);
      const nid = newId();
      existing.ctx.id = nid;
      sessions.set(nid, existing);
      return existing.ctx;
    },
  };
}
