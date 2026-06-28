import { randomBytes } from "node:crypto";
import type { SessionCtx } from "../types.js";

export interface SessionStore {
  create(): SessionCtx;
  get(id: string): SessionCtx | undefined;
  delete(id: string): void;
  /** Regenerate the id for an existing session (session-fixation defense on login). */
  rotate(id: string): SessionCtx | undefined;
}

/**
 * In-memory session store. Holds the runner's server-side state (including any
 * OAuth tokens the runner keeps) keyed by an opaque id carried in a signed
 * HttpOnly cookie. NOTE: in-memory means a restart invalidates all sessions —
 * swap for a shared store (Redis, etc.) in production. Sessions TTL-expire.
 */
export function createMemorySessionStore(opts: { ttlMs?: number } = {}): SessionStore {
  const ttlMs = opts.ttlMs ?? 24 * 60 * 60 * 1000; // 24h
  const sessions = new Map<string, { ctx: SessionCtx; createdAt: number }>();

  const newId = () => randomBytes(24).toString("base64url");

  const reap = () => {
    const now = Date.now();
    for (const [id, s] of sessions) {
      if (now - s.createdAt > ttlMs) sessions.delete(id);
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
      sessions.delete(id);
    },
    rotate(id) {
      const existing = sessions.get(id);
      if (!existing) return undefined;
      sessions.delete(id);
      const nid = newId();
      existing.ctx.id = nid;
      sessions.set(nid, existing);
      return existing.ctx;
    },
  };
}
