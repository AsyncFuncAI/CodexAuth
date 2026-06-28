/**
 * directRunner — a CodexRunner that talks to OpenAI directly over HTTP (no
 * `codex` CLI binary). Because it is pure `fetch`, it works on serverless
 * platforms (Vercel functions, Cloudflare with nodejs_compat, etc.) where the
 * CLI-based defaultCliRunner cannot run.
 *
 * It is a drop-in alternative to defaultCliRunner — same CodexRunner interface,
 * so the router, contract, and <CodexAuth> component are all unchanged:
 *
 *   import { createCodexRouter } from "codex-auth/backend";
 *   import { directRunner } from "codex-auth/backend/direct";
 *   createCodexRouter({ runner: directRunner(), cookieSecret: ... });
 *
 * Tokens are held server-side in the session's ctx.data and refreshed when
 * expired — they are never returned to the browser (token-confinement guard
 * still applies). See SECURITY.md for the off-label-API caveats.
 */
import type {
  CodexRunner,
  SessionCtx,
  StartDeviceLoginResult,
  GetStatusResult,
} from "../types.js";
import type { RunStreamEvent } from "../../core/contract.js";
import {
  startDeviceAuth,
  pollDeviceAuth,
  refreshAccessToken,
  DEVICE_VERIFICATION_URL,
  type OAuthCredentials,
} from "./oauth.js";
import { runDirect } from "./responses.js";

export interface DirectRunnerOptions {
  /** Injectable fetch (tests / custom transport). Defaults to global fetch. */
  fetch?: typeof fetch;
  /** Override the model list (skips account-aware discovery). */
  models?: string[];
  /** Reasoning effort: minimal | low | medium | high. Default low. */
  effort?: string;
  /** Device-code expiry window in ms (for the contract's expiresAt). Default 15m. */
  deviceCodeTtlMs?: number;
}

// What we stash on the session.
interface DirectState {
  deviceAuthId?: string;
  userCode?: string;
  creds?: OAuthCredentials;
}

export function directRunner(opts: DirectRunnerOptions = {}): CodexRunner {
  const f = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const ttl = opts.deviceCodeTtlMs ?? 15 * 60 * 1000;

  const state = (ctx: SessionCtx): DirectState => {
    if (!ctx.data.direct) ctx.data.direct = {} as DirectState;
    return ctx.data.direct as DirectState;
  };

  /** Return live credentials for the session, refreshing if expired. */
  async function ensureCreds(ctx: SessionCtx): Promise<OAuthCredentials | null> {
    const s = state(ctx);
    if (!s.creds) return null;
    // Refresh slightly before expiry.
    if (s.creds.expires - Date.now() < 60_000) {
      try {
        s.creds = await refreshAccessToken(s.creds.refresh, f);
      } catch {
        s.creds = undefined;
        return null;
      }
    }
    return s.creds;
  }

  return {
    async startDeviceLogin(ctx: SessionCtx): Promise<StartDeviceLoginResult> {
      if (await ensureCreds(ctx)) return { loggedIn: true };
      try {
        const device = await startDeviceAuth(f);
        const s = state(ctx);
        s.deviceAuthId = device.deviceAuthId;
        s.userCode = device.userCode;
        return {
          loginUrl: DEVICE_VERIFICATION_URL,
          userCode: device.userCode,
          expiresAt: Date.now() + ttl,
        };
      } catch (e) {
        // A failure to even start the device flow is most often device-auth not
        // being enabled on the account.
        void e;
        return { errorCode: "DEVICE_AUTH_NOT_ENABLED" };
      }
    },

    async getStatus(ctx: SessionCtx): Promise<GetStatusResult> {
      // Already authenticated?
      const live = await ensureCreds(ctx);
      if (live) return { ok: true, account: live.account ?? "ChatGPT account" };

      // Mid-device-flow: poll OpenAI once.
      const s = state(ctx);
      if (!s.deviceAuthId || !s.userCode) return { ok: false, status: "pending" };
      const result = await pollDeviceAuth(s.deviceAuthId, s.userCode, f);
      if (result.status === "complete") {
        s.creds = result.credentials;
        s.deviceAuthId = undefined;
        s.userCode = undefined;
        return { ok: true, account: result.credentials.account ?? "ChatGPT account" };
      }
      if (result.status === "failed") return { ok: false, status: "logged_out" };
      return { ok: false, status: "pending" }; // pending | slow_down
    },

    async *run(ctx: SessionCtx, prompt: string, signal?: AbortSignal): AsyncIterable<RunStreamEvent> {
      const creds = await ensureCreds(ctx);
      if (!creds) {
        yield { type: "error", error: "not authenticated" };
        return;
      }
      yield* runDirect(
        { access: creds.access, accountId: creds.accountId },
        { prompt, models: opts.models, effort: opts.effort, signal },
        f,
      );
    },

    async logout(ctx: SessionCtx): Promise<void> {
      // Tokens are only in memory; dropping them logs the session out.
      ctx.data.direct = {} as DirectState;
    },
  };
}
