# `<CodexAuth />`

Drop a ChatGPT sign-in into any React app. The device-code OAuth flow, the
polling, the session handling: all headless, all yours to style. Your users
bring their own ChatGPT plan (Free, Plus, or Pro); you ship the button.

An open-source, headless-first React component + npm package. It uses the
official Codex CLI **device-code** flow, proxied through a small backend you
host. **OAuth tokens never touch the browser**: they stay in your backend's
session, the same way the Codex CLI keeps them in `~/.codex/auth.json`.

```
npm install codex-auth
```

> Requires React 17+. The reference backend requires Node and the official
> [`codex`](https://developers.openai.com/codex) CLI installed on the server.

---

## Why this needs a backend (important)

`<CodexAuth>` is a **drop-in component for an app that has a backend** — not a
browser-only widget. Here's why, in one paragraph:

The whole point is that your users authenticate with their **own ChatGPT
account** and you **never pay OpenAI**. That means real OAuth tokens for their
account exist somewhere. If those tokens lived in the browser, any XSS could
steal them and hijack the user's ChatGPT account. So the security model is
**tokens never touch the browser** — they live on a server you control, which
talks to OpenAI and runs the prompts. The browser only ever sees an `HttpOnly`
cookie and the streamed output.

This is exactly how the original login-with-chatgpt works (it runs a server-side
Codex process), and it's the same reason Clerk/Auth0/your-own-DB all need a
backend. **The component gives you the hard 80%** — the popup flow, device-code
UX, polling, sessions, and a security-hardened HTTP contract. **You bring a small
backend endpoint** (one of the drop-in adapters below).

### Two runners — pick how the backend talks to OpenAI

The component is the same; the **runner** decides how your backend reaches OpenAI:

| Runner | How it works | Deploys on |
|---|---|---|
| **`directRunner`** (`codex-auth/backend/direct`) | Pure `fetch` — the device-code grant + the Codex `responses` backend directly | **Anywhere, incl. Vercel serverless / edge.** No binary, no persistent process |
| **`defaultCliRunner`** (`codex-auth/backend`) | Shells out to the official `codex` CLI | A **persistent** Node host (Railway, Render, Docker, a VPS) — not Vercel functions |

> `directRunner` is the easy default for most apps: it has no native dependency, so
> the whole thing (frontend + backend) can live in one Vercel/Next.js deploy.
> `defaultCliRunner` exists for when you'd rather lean on the installed CLI's auth.
> Both implement the same `CodexRunner` interface and hold tokens server-side.

```ts
// serverless-friendly: no codex binary needed
import { createCodexRouter } from "codex-auth/backend";
import { directRunner } from "codex-auth/backend/direct";

createCodexRouter({ runner: directRunner(), cookieSecret: process.env.COOKIE_SECRET! });
```

See [`DEPLOYMENT.md`](./DEPLOYMENT.md) for Vercel, Railway (one-click), Docker, and
Next.js, and [`SECURITY.md`](./SECURITY.md) for the off-label-API caveats `directRunner`
inherits.

Backend adapters (all share one hardened core, work with either runner):

| Import | For |
|---|---|
| `codex-auth/backend` | Express (`createCodexRouter`) — the generic reference |
| `codex-auth/backend/next` | Next.js App Router route handler |
| `codex-auth/backend/direct` | the serverless-friendly `directRunner` |
| `codex-auth/backend/worker` | Cloudflare Worker — proxy in front of a Node backend |

---

## Quick start

### 1. Frontend — drop in the component

```tsx
import { CodexAuth } from "codex-auth";

export function SignIn() {
  return <CodexAuth onAuthenticated={({ account }) => console.log("hi", account)} />;
}
```

That renders the default "Login with ChatGPT" button, the device-code card, the
popup-blocked fallback, and an account console after login.

### 2. Backend — mount the reference router

```ts
import express from "express";
import { createCodexRouter, defaultCliRunner } from "codex-auth/backend";

const app = express();
app.use(
  "/api/codex",
  createCodexRouter({
    runner: defaultCliRunner(),               // shells out to the `codex` CLI
    cookieSecret: process.env.COOKIE_SECRET!, // 32-byte random, from env
  }),
);
app.listen(8787);
```

The component talks to `/api/codex/*` on the **same origin** by default. That's it.

### 3. Your users must enable device auth (one time)

The first time, a user opens **ChatGPT → Settings → Security & Login** and enables
**device code authorization**. The component shows this hint automatically if the
backend reports `DEVICE_AUTH_NOT_ENABLED`.

---

## Headless usage (full control of the UI)

Pass a function as `children` to get the full auth state and render whatever you
want. No default UI is rendered.

```tsx
<CodexAuth>
  {(auth) =>
    auth.isAuthenticated ? (
      <button onClick={auth.logout}>Sign out {auth.account}</button>
    ) : auth.isWaiting ? (
      <p>Enter code {auth.userCode} in the popup…</p>
    ) : (
      <button onClick={auth.login}>Login with ChatGPT</button>
    )
  }
</CodexAuth>
```

`useCodexAuth()` exposes the same result if you prefer a hook:

```tsx
const auth = useCodexAuth({ pollIntervalMs: 2500 });
```

### Running prompts

Once authenticated, stream a prompt against the user's account:

```tsx
auth.run("Write a haiku about the ocean.", {
  onText: (text, mode) => append(text, mode),
  onDone: ({ text }) => console.log("final:", text),
  onError: (e) => console.error(e),
});
```

Need just the run client without the auth UI? Import from `codex-auth/run`.

---

## Configuration (`CodexClientConfig`)

| Option | Default | Purpose |
|---|---|---|
| `basePath` | `/api/codex` | Base path for the contract |
| `endpoints` | derived | Per-route overrides (absolute URL or relative path; replaces verbatim) |
| `fetch` | `globalThis.fetch` | Injectable fetch (SSR/tests) |
| `pollIntervalMs` | `3000` | Status poll cadence |
| `resumeMaxAgeMs` | `86_400_000` | Resume a persisted session within 24h |
| `storage` | `localStorage` | Persistence backend; `null` disables (SSR-safe) |
| `credentials` | `same-origin` | fetch credentials mode (see Cross-origin below) |
| `allowedLoginHosts` | `["auth.openai.com"]` | Hosts the login popup may navigate to |
| `enableGravatar` | `false` | Opt-in Gravatar avatar (leaks an email MD5 to gravatar.com) |

### `useCodexAuth()` result

`status` (`idle` · `resuming` · `connecting` · `waitingForLogin` · `authenticated` ·
`error` · `loggedOut`), `account`, `userCode`, `loginUrl`, `expiresAt`, `error`,
`popupBlocked`, derived `isAuthenticated`/`isConnecting`/`isWaiting`, `avatarUrl`,
and actions `login()`, `logout()`, `cancelLogin()`, `run()`, `copyUserCode()`,
`openLoginPage()`.

---

## How it works (the popup trick)

1. On click, the component opens a **blank popup synchronously** — before any
   `await` — so the browser's popup blocker permits it, and shows a "Connecting…"
   holding screen.
2. It calls your backend (`POST /session`, `POST /login/start`), which runs the
   Codex CLI device-code flow and returns a `loginUrl` + `userCode`.
3. The popup is pointed at the (validated) `loginUrl` on `auth.openai.com`. The
   user approves; the component polls `GET /status` every few seconds.
4. On success it shows the account. **Tokens stay on your backend the whole time.**

See [`CONTRACT.md`](./CONTRACT.md) for the exact HTTP contract (so you can write a
backend in any language) and [`SECURITY.md`](./SECURITY.md) for the trust model.

---

## Run the demo

```
cp demo/.env.example demo/.env   # set COOKIE_SECRET
npm install
npm run demo                     # backend on :8787, app on :5173
```

You need the `codex` CLI installed and `codex login --device-auth` available.

---

## Cross-origin backends

Default `credentials` is `same-origin` — keep it that way when the app and backend
share an origin (recommended). For a backend on a **different** origin:

- set `credentials: 'include'` on the client, **and**
- pass `allowedOrigins: ['https://your-app.example']` to `createCodexRouter` so it
  emits credentialed CORS for that **specific** origin (never `*`).

Never reflect an arbitrary `Origin` with credentials — see `SECURITY.md`.

---

## License

MIT. Not affiliated with OpenAI.
