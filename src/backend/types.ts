import type { RunStreamEvent } from "../core/contract.js";

/** Per-request session context handed to the runner. Tokens live here, server-side only. */
export interface SessionCtx {
  id: string;
  /** Arbitrary runner-owned state (e.g. a codex home dir, device-login handle). */
  data: Record<string, unknown>;
}

export type StartDeviceLoginResult =
  | { loggedIn: true }
  | { loginUrl: string; userCode: string; expiresAt: number }
  | { errorCode: "DEVICE_AUTH_NOT_ENABLED" };

export type GetStatusResult =
  | { ok: true; account: string }
  | { ok: false; status?: string };

/**
 * A CodexRunner performs the actual device-code login, status check, and prompt
 * execution. The default implementation shells out to the official `codex` CLI;
 * an alternative could implement the device-code grant against auth.openai.com
 * directly (PKCE S256, client_id app_EMoamEEZ73f0CkXaXp7hrann).
 *
 * IMPLEMENTATIONS MUST NOT return OAuth tokens to the caller — only the fields
 * in these result types. Tokens stay inside the runner / session store.
 */
export interface CodexRunner {
  startDeviceLogin(ctx: SessionCtx): Promise<StartDeviceLoginResult>;
  getStatus(ctx: SessionCtx): Promise<GetStatusResult>;
  run(ctx: SessionCtx, prompt: string, signal?: AbortSignal): AsyncIterable<RunStreamEvent>;
  logout(ctx: SessionCtx): Promise<void>;
}
