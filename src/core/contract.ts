/**
 * The HTTP contract between <CodexAuth> (browser) and the backend.
 *
 * This is the single source of truth. OAuth tokens NEVER appear in any of these
 * response shapes — they live only in the backend's session store. See CONTRACT.md
 * for the prose spec and SECURITY.md for the trust model.
 *
 * Verified against login-with-chatgpt.vercel.app's app.js and the official
 * `codex` CLI (`codex login --device-auth`, `codex login status`, `codex exec --json`).
 */

/** POST {basePath}/session — provisions/ensures a backend session (idempotent). */
export type SessionResponse = { ok: true } | { ok: false; error: string };

/**
 * POST {basePath}/login/start — starts the device-code flow on the backend.
 * - `{ ok: true, loggedIn: true }` → already authenticated, skip the popup.
 * - `{ loginUrl, userCode, expiresAt }` → point the popup at loginUrl, show the code.
 * - `{ errorCode: 'DEVICE_AUTH_NOT_ENABLED' }` → user must enable device auth in ChatGPT.
 */
export type LoginStartResponse =
  | { ok: true; loggedIn: true }
  | LoginStartPending
  | { errorCode: "DEVICE_AUTH_NOT_ENABLED" }
  | { error: string };

export interface LoginStartPending {
  loginUrl: string;
  userCode: string;
  /** Absolute deadline in epoch milliseconds (NOT seconds, NOT a duration). */
  expiresAt: number;
}

/**
 * GET {basePath}/status — polling target.
 * `{ ok: false }` alone means "pending / not yet authenticated" and must NOT sign
 * the user out. A definitive logged-out state is `{ ok: false, status: 'logged_out' }`
 * or an HTTP 401 (see isLoggedOutSignal in poll.ts).
 */
export type StatusResponse =
  | { ok: true; account: string }
  | { ok: false; status?: string; error?: string };

/** POST {basePath}/run/stream request body. The wire field is `prompt` (verified from app.js). */
export interface RunRequest {
  prompt: string;
}

/** One NDJSON line from POST {basePath}/run/stream. */
export type RunStreamEvent =
  | { type: "assistant-text"; mode: "append" | "replace"; text: string }
  | { type: "done"; result: { text: string } }
  | { type: "error"; error: string };

/** POST {basePath}/logout — clears the backend session. */
export type LogoutResponse = Record<string, never>;

/** Resolved absolute (or relative) paths/URLs for each route. */
export interface EndpointMap {
  session: string;
  loginStart: string;
  status: string;
  runStream: string;
  logout: string;
}

/** Pluggable storage shape (a subset of the Web Storage API). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Configuration for the core client and the React layer. */
export interface CodexClientConfig {
  /** Base path for the contract. Default `/api/codex`. */
  basePath?: string;
  /**
   * Per-route overrides. Each provided value REPLACES the basePath-derived path
   * verbatim (absolute URL for cross-origin, or a relative path). Unset routes
   * stay basePath-derived.
   */
  endpoints?: Partial<EndpointMap>;
  /** Injectable fetch (tests/SSR). Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
  /** Status poll cadence in ms. Default 3000. */
  pollIntervalMs?: number;
  /** Resume window in ms. Default 86_400_000 (24h). */
  resumeMaxAgeMs?: number;
  /** Persistence backend. Default localStorage; pass null to disable (SSR-safe). */
  storage?: StorageLike | null;
  /** localStorage key. Default `codex-auth:session`. */
  storageKey?: string;
  /** fetch credentials mode. Default 'same-origin'. Do NOT default to 'include'. */
  credentials?: RequestCredentials;
  /** Allowed hosts for the login popup URL. Default ['auth.openai.com']. */
  allowedLoginHosts?: string[];
  /** Max consecutive status-poll failures before STATUS_FAILED. Default 5. */
  maxPollFailures?: number;
  /** Max NDJSON line length in bytes before RUN_FAILED. Default 1_048_576 (1MB). */
  maxStreamLineBytes?: number;
}

export type CodexAuthStatus =
  | "idle"
  | "resuming"
  | "connecting"
  | "waitingForLogin"
  | "authenticated"
  | "error"
  | "loggedOut";

export type CodexAuthErrorCode =
  | "DEVICE_AUTH_NOT_ENABLED"
  | "POPUP_BLOCKED"
  | "SESSION_FAILED"
  | "LOGIN_FAILED"
  | "STATUS_FAILED"
  | "RUN_FAILED"
  | "NETWORK"
  | "EXPIRED";

export interface CodexAuthError {
  code: CodexAuthErrorCode;
  message: string;
  cause?: unknown;
}

/** Serializable state emitted by the core client's subscribe(). */
export interface CodexAuthSnapshot {
  status: CodexAuthStatus;
  account: string | null;
  userCode: string | null;
  loginUrl: string | null;
  /** Absolute epoch-ms deadline for the device code, or null. */
  expiresAt: number | null;
  popupBlocked: boolean;
  error: CodexAuthError | null;
}
