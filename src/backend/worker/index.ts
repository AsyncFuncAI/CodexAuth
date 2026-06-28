/**
 * codex-auth/backend/worker — Cloudflare Worker (proxy-only).
 *
 * A Worker CANNOT run the `codex` CLI (no child_process / filesystem), so it
 * cannot be the full backend. This adapter reverse-proxies /api/codex/* to a
 * Node "device-runner" you host elsewhere (Railway/Render/Docker), forwarding
 * cookies and the request body, and streaming the NDJSON response back.
 *
 * Use it when you want an edge front door (custom domain, WAF, caching for the
 * rest of your site) in front of the Node backend.
 *
 * wrangler.toml:
 *   name = "codex-auth-proxy"
 *   main = "worker.js"
 *   [vars]
 *   CODEX_BACKEND_ORIGIN = "https://your-node-backend.example.com"
 */
export interface ProxyEnv {
  /** Origin of the Node backend that actually runs createCodexRouter/handler. */
  CODEX_BACKEND_ORIGIN: string;
  /** Path prefix to proxy. Default "/api/codex". */
  CODEX_BASE_PATH?: string;
}

export function createCodexProxy() {
  return {
    async fetch(request: Request, env: ProxyEnv): Promise<Response> {
      const base = env.CODEX_BASE_PATH ?? "/api/codex";
      const url = new URL(request.url);
      if (!url.pathname.startsWith(base)) {
        return new Response("not found", { status: 404 });
      }
      const target = new URL(env.CODEX_BACKEND_ORIGIN);
      target.pathname = url.pathname;
      target.search = url.search;

      // Forward method, headers (incl. cookie), and body. Preserve streaming.
      const proxied = new Request(target.toString(), {
        method: request.method,
        headers: request.headers,
        body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
        redirect: "manual",
      });
      // The backend enforces CSRF via Sec-Fetch-Site/Origin; we pass them through.
      const resp = await fetch(proxied);
      // Stream the response straight back (NDJSON for /run/stream).
      return new Response(resp.body, {
        status: resp.status,
        headers: resp.headers,
      });
    },
  };
}

export default createCodexProxy();
