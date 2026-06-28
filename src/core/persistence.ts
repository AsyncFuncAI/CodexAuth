import type { StorageLike } from "./contract.js";

export const DEFAULT_STORAGE_KEY = "codex-auth:session";
export const DEFAULT_RESUME_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Persisted session marker. We deliberately do NOT persist the account email by
 * default — it is PII readable by any XSS on the origin. The email is re-fetched
 * from /status on resume. Set `persistAccount` to opt in.
 */
export interface PersistedSession {
  loggedIn: true;
  savedAt: number;
  account?: string;
}

export interface PersistenceOptions {
  storage?: StorageLike | null;
  storageKey?: string;
  resumeMaxAgeMs?: number;
  now?: () => number;
  persistAccount?: boolean;
}

/** Resolve the default browser storage, guarding SSR where window is absent. */
export function defaultStorage(): StorageLike | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    /* localStorage can throw in sandboxed iframes / privacy modes */
  }
  return null;
}

export function createPersistence(opts: PersistenceOptions = {}) {
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  const key = opts.storageKey ?? DEFAULT_STORAGE_KEY;
  const maxAge = opts.resumeMaxAgeMs ?? DEFAULT_RESUME_MAX_AGE_MS;
  const now = opts.now ?? (() => Date.now());
  const persistAccount = opts.persistAccount ?? false;

  function save(account?: string): void {
    if (!storage) return;
    const payload: PersistedSession = {
      loggedIn: true,
      savedAt: now(),
      ...(persistAccount && account ? { account } : {}),
    };
    try {
      storage.setItem(key, JSON.stringify(payload));
    } catch {
      /* over quota / unavailable — degrade silently */
    }
  }

  function clear(): void {
    if (!storage) return;
    try {
      storage.removeItem(key);
    } catch {
      /* ignore */
    }
  }

  /** Return a fresh persisted session, or null if absent/stale (clearing stale). */
  function load(): PersistedSession | null {
    if (!storage) return null;
    let raw: string | null;
    try {
      raw = storage.getItem(key);
    } catch {
      return null;
    }
    if (!raw) return null;
    let parsed: PersistedSession | null = null;
    try {
      parsed = JSON.parse(raw) as PersistedSession;
    } catch {
      clear();
      return null;
    }
    if (!parsed || parsed.loggedIn !== true || typeof parsed.savedAt !== "number") {
      clear();
      return null;
    }
    if (now() - parsed.savedAt > maxAge) {
      clear();
      return null;
    }
    return parsed;
  }

  return { save, clear, load };
}

export type Persistence = ReturnType<typeof createPersistence>;
