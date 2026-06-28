/**
 * Cloudflare Worker for the CodexAuth demo.
 *
 *   - /api/codex/*  → reverse-proxied to the backend running on a "box" VM
 *                     (a clean residential-ish IP). The directRunner there can
 *                     reach chatgpt.com/backend-api, which a Worker's datacenter
 *                     IP cannot (OpenAI's Cloudflare challenges it). The browser
 *                     only ever talks to codexauth.sharenow.today — same-origin,
 *                     so the HttpOnly session cookie round-trips normally.
 *   - everything else → the React SPA from the ASSETS binding.
 *
 * CODEX_BACKEND_ORIGIN (var) is the box's public HTTPS origin.
 */
import type { Fetcher } from "@cloudflare/workers-types";

interface Env {
  ASSETS: Fetcher;
  CODEX_BACKEND_ORIGIN: string;
}

const BASE_PATH = "/api/codex";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith(BASE_PATH)) {
      const backend = env.CODEX_BACKEND_ORIGIN?.replace(/\/+$/, "");
      if (!backend) return new Response("CODEX_BACKEND_ORIGIN not set", { status: 500 });

      const target = new URL(backend);
      target.pathname = url.pathname;
      target.search = url.search;

      // Forward method, headers (incl. cookie), and body. Preserve streaming both
      // ways (NDJSON for /run/stream).
      const proxied = new Request(target.toString(), {
        method: request.method,
        headers: request.headers,
        body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
        redirect: "manual",
      });
      const resp = await fetch(proxied);
      return new Response(resp.body, {
        status: resp.status,
        statusText: resp.statusText,
        headers: resp.headers,
      });
    }

    return env.ASSETS.fetch(request);
  },
};
