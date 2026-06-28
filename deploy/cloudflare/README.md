# Deploy to Cloudflare Workers

The whole app (React SPA **+** the `/api/codex/*` API) runs on a **single
Cloudflare Worker** — no Node host, no `codex` binary. It uses the `directRunner`
(pure `fetch`) and persists sessions in **KV**, so it's fully serverless.

```
codexauth.sharenow.today (Worker)
  ├─ /api/codex/*   → handleCodexRequestKV + directRunner   (sessions → KV)
  └─ /*             → React SPA (ASSETS binding)
```

## One-time setup

```bash
# 1. create the KV namespace (binding: CODEX_SESSIONS)
npx wrangler kv namespace create codexauth-sessions
#    → paste the returned id into wrangler.jsonc kv_namespaces[0].id

# 2. set the signed-cookie secret (32-byte random)
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))" \
  | npx wrangler secret put COOKIE_SECRET --config deploy/cloudflare/wrangler.jsonc
```

## Build + deploy

```bash
# build the SPA into deploy/cloudflare/public
npx vite build --config demo/vite.config.ts --outDir "$PWD/deploy/cloudflare/public" --emptyOutDir

# deploy the Worker (serves the SPA + the API)
npx wrangler deploy --config deploy/cloudflare/wrangler.jsonc
```

`wrangler.jsonc` binds the Worker to the custom domain `codexauth.sharenow.today`
and sets `workers_dev: false`, so the `*.workers.dev` URL is not exposed. Point
`routes[].pattern` at your own hostname to change it.

## Notes

- **Sessions live in KV**, keyed by the signed cookie id, with a 24h TTL. Tokens
  never reach the browser (KV is server-side).
- `nodejs_compat` is enabled for `Buffer` in the cookie-signing path.
- Auth required by the token: Workers Scripts (edit), Workers KV (edit), and
  Workers Routes / a Custom Domain on the target zone.
- The same caveats as everywhere apply — see the root [`SECURITY.md`](../../SECURITY.md).
