/**
 * Cloudflare Worker that hosts the whole CodexAuth demo:
 *   - /api/codex/*  → the contract handler + directRunner (pure fetch, no CLI),
 *                     with session/token state persisted to KV
 *   - everything else → the React SPA from the ASSETS binding
 *
 * This is the serverless deploy: no Node binary, no persistent process. Built on
 * the same codex-auth/backend the Express/Next adapters use.
 */
import { handleCodexRequestKV } from "../../src/backend/cloudflare/kvSessionStore.js";
import { directRunner } from "../../src/backend/direct/index.js";
import type { KVNamespace, Fetcher } from "@cloudflare/workers-types";

interface Env {
  ASSETS: Fetcher;
  CODEX_SESSIONS: KVNamespace;
  COOKIE_SECRET: string;
  CODEX_MODEL?: string;
}

const BASE_PATH = "/api/codex";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith(BASE_PATH)) {
      if (!env.COOKIE_SECRET || env.COOKIE_SECRET.length < 16) {
        return new Response("COOKIE_SECRET is not configured", { status: 500 });
      }
      return handleCodexRequestKV(request, {
        kv: env.CODEX_SESSIONS,
        cookieSecret: env.COOKIE_SECRET,
        basePath: BASE_PATH,
        // Force gpt-5.5: it's the model the ChatGPT-account responses backend
        // accepts. Account-aware /models discovery is often Cloudflare-blocked
        // from a Worker's datacenter IP, and the generic fallbacks (gpt-5-codex,
        // gpt-5) are rejected — verified live.
        runner: directRunner({ models: [env.CODEX_MODEL ?? "gpt-5.5"] }),
      });
    }

    // Everything else is the static SPA.
    return env.ASSETS.fetch(request);
  },
};
