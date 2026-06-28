# Deploying codex-auth

## Why a backend is required (read this first)

`<CodexAuth>` lets your users sign in with their **personal ChatGPT account** and
run prompts on it. The security model is **"OAuth tokens never touch the
browser."** Those tokens grant access to the user's ChatGPT account — if they
lived in the browser, any XSS (or any script on the page) could steal them.

So the tokens must live on a server you control. The browser only ever talks to
your backend over the `/api/codex/*` contract; your backend holds the tokens and
runs the prompts (via the official `codex` CLI). This is the same architecture as
the original login-with-chatgpt demo — it also runs a server-side Codex process.

**This means `<CodexAuth>` cannot be a browser-only component.** It is a *drop-in
component for an app that has a backend* — which is most React apps. You bring a
backend endpoint; the component handles all the browser UX (popup, device code,
polling, sessions) and the hardened contract.

```
┌────────────┐     /api/codex/*      ┌──────────────────────┐      codex CLI     ┌──────────────┐
│  Browser   │  ◄─── HttpOnly ────►  │  Your backend        │  ◄──────────────►  │ auth.openai  │
│ <CodexAuth>│       cookie          │  (holds the tokens)  │                    │ .com         │
└────────────┘   no tokens ever      └──────────────────────┘                    └──────────────┘
```

## The split: frontend anywhere, backend on a persistent host

| Piece | Where it runs | Notes |
|---|---|---|
| **Frontend** (React app + `<CodexAuth>`) | **Anywhere** — Vercel, Netlify, Cloudflare Pages, static host | Pure browser code |
| **Backend** (`createCodexRouter` + `codex` CLI) | A **persistent** host — Railway, Render, a Docker container, a VPS, a long-running Node server | Needs a real process + filesystem to run the CLI |

**The backend must stay running** for login and prompts to work — like any auth
or API backend (Clerk, Auth0, your own DB all require this too).

### ⚠️ Vercel (and other serverless functions) and the CLI runner

The default backend (`defaultCliRunner`) **shells out to the `codex` CLI**, which
needs `child_process`, a writable filesystem (`~/.codex/auth.json`), and a
long-lived process (the device-login process stays alive while polling). **Vercel
serverless functions, Netlify functions, and Cloudflare Workers cannot do this** —
they're ephemeral, read-only, and short-lived, and don't have the `codex` binary.

- ✅ Deploy your **frontend** to Vercel.
- ❌ Do **not** run the **CLI backend** on Vercel functions.
- ➡️ Run the backend on a **persistent** host (below) and point your frontend's
  `/api/codex` at it (proxy, rewrite, or absolute `basePath`/`endpoints` config).

A future `CodexRunner` that calls the OpenAI API directly (no CLI) could be more
serverless-friendly — the `CodexRunner` interface is the extension point — but the
reference runner is CLI-based.

---

## Option A — Railway (easiest persistent host)

Railway builds the included Dockerfile and keeps the process alive.

1. Push this repo to GitHub.
2. In Railway: **New Project → Deploy from GitHub repo**.
3. Railway picks up `deploy/railway.json` → builds `deploy/Dockerfile`.
4. Add a variable: `COOKIE_SECRET` = output of `openssl rand -base64 32`.
   (Optional: `CODEX_MODEL=gpt-5.5`, `ALLOWED_ORIGINS=https://your-frontend.app`.)
5. Deploy. Your backend is at `https://<your-app>.up.railway.app`.
6. **One-time auth:** open a Railway shell and run `codex login --device-auth`,
   follow the device-code link, and approve. (Tokens persist in the container's
   `~/.codex`. For a fresh container on each deploy, use a Railway **volume**
   mounted at `/root/.codex` so the login survives restarts — see Persisting auth.)

Point your frontend at it: set the component's `basePath` to
`https://<your-app>.up.railway.app/api/codex` with `credentials: 'include'`, and
set `ALLOWED_ORIGINS` on the backend to your frontend's origin (see Cross-origin).

## Option B — Docker (any container host)

```bash
docker build -f deploy/Dockerfile -t codex-auth-backend .
docker run -p 8787:8787 \
  -e COOKIE_SECRET="$(openssl rand -base64 32)" \
  -e CODEX_MODEL=gpt-5.5 \
  -v codex-home:/root/.codex \
  codex-auth-backend
# one-time: docker exec -it <container> codex login --device-auth
```

The `-v codex-home:/root/.codex` volume persists the login across restarts.

## Option C — Next.js (single app, no separate backend)

If your frontend **is** a Next.js app running on a Node server (not Vercel
serverless — a Node host, container, or `next start` on a persistent box), mount
the route handler in the same app:

```ts
// app/api/codex/[...codex]/route.ts
import { createNextCodexHandler, defaultCliRunner } from "codex-auth/backend/next";

export const runtime = "nodejs"; // NOT edge — the CLI needs Node

export const { GET, POST } = createNextCodexHandler({
  runner: defaultCliRunner({ model: "gpt-5.5" }),
  cookieSecret: process.env.COOKIE_SECRET!,
});
```

Then `<CodexAuth />` works with no config (same-origin `/api/codex`). The same
Vercel caveat applies: host this Next app where a Node process can run the CLI.

## Option D — Cloudflare Worker (edge front door, proxy only)

A Worker can't run the CLI, but it can reverse-proxy `/api/codex/*` to a Node
backend (Option A/B), giving you an edge front door / custom domain:

```ts
// worker.ts
import { createCodexProxy } from "codex-auth/backend/worker";
export default createCodexProxy();
```

```toml
# wrangler.toml
name = "codex-auth-proxy"
main = "worker.ts"
[vars]
CODEX_BACKEND_ORIGIN = "https://<your-railway-app>.up.railway.app"
```

---

## Cross-origin (frontend and backend on different domains)

Default `credentials` is `same-origin`. When the backend is on another origin:

- On the **client**: `<CodexAuth basePath="https://backend.example/api/codex" credentials="include" />`
- On the **backend**: set `ALLOWED_ORIGINS=https://frontend.example` (the router
  emits credentialed CORS for that *specific* origin — never `*`).

Prefer **same-origin** (a proxy/rewrite from your frontend to the backend) when
you can — it avoids cross-site cookies entirely and is the most robust.

## Persisting auth across restarts

The CLI stores tokens in `~/.codex/auth.json`. On ephemeral containers this is
lost on each deploy, forcing a re-login. Mount a persistent volume at the home
`.codex` dir (Railway volume, Docker `-v`, etc.) so the login survives.

## Security checklist before production

- [ ] `COOKIE_SECRET` is high-entropy and from a secret store (never in source).
- [ ] Backend served over **HTTPS** (so the `Secure` cookie works).
- [ ] `ALLOWED_ORIGINS` set if cross-origin; otherwise same-origin.
- [ ] Add **rate limiting** to `/login/start` and `/run/stream` (prevents quota burn).
- [ ] Swap the in-memory session store for a shared one (Redis) if you run >1 instance.
- [ ] Review [`SECURITY.md`](./SECURITY.md) for the full threat model.
