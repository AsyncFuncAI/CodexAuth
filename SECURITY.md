# Security model

`<CodexAuth>` is a security-sensitive component: it brokers access to a user's
personal ChatGPT account. This document states the trust model and the hardening
the reference backend ships with.

## Where tokens live

OAuth tokens (`access_token`, `refresh_token`, `expires_at`) live **only on the
backend**, inside the session store / the `codex` CLI's `~/.codex/auth.json`.
**No token ever appears in any HTTP response** to the browser, in any cookie
value, in any error message, or in any stream event. This invariant is enforced
by a guard test (`tests/token-confinement.test.ts`) and by keeping the backend in
a separate `codex-auth/backend` entry that the browser bundle never imports.

## Session cookie

The reference router (`createCodexRouter`) sets a session cookie that is:

- **`HttpOnly`** — unreadable from JavaScript (so the client always calls
  `/session` rather than trying to detect the cookie).
- **`Secure`** — never sent over plaintext. (Disable only for local HTTP dev via
  `cookieOptions: { secure: false }`.)
- **`SameSite=Strict`** — not attached to cross-site requests.
- **signed** with `cookieSecret` (must be ≥16 chars, high-entropy, from env).
- **rotated on successful login** — session-fixation defense.

In-memory sessions are the default and **TTL-expire**; a process restart
invalidates them. Use a shared store (Redis, etc.) in production.

## CSRF

The contract is cookie-authenticated, so every `POST` is CSRF-protected: the
router rejects requests whose `Sec-Fetch-Site` is cross-site (or whose `Origin`
host differs from `Host`), unless the origin is explicitly allowlisted. This is in
addition to `SameSite=Strict`. The PKCE `state` parameter protects the backend's
*upstream* call to `auth.openai.com` — it does **not** protect the browser↔backend
contract; that's what the CSRF check is for.

## CORS / cross-origin

- Default `credentials` is `same-origin`. **Do not** default to `'include'`.
- For a cross-origin backend, pass `allowedOrigins` to `createCodexRouter`. It
  emits `Access-Control-Allow-Credentials: true` with the **specific** allowed
  origin — never `*`, never a reflected arbitrary origin. Unlisted origins get no
  CORS headers and are rejected.

## Popup / open-redirect

The login URL returned by `/login/start` is validated before the popup navigates
to it: it must be `https:` and on an allowed host (default `auth.openai.com`).
`javascript:` and `http:` URLs are rejected. The holding screen written into the
popup is a static constant — no server data is interpolated (no XSS sink). The
popup-blocked fallback anchor uses `rel="noopener noreferrer"`.

## Streamed output

Assistant text from `/run/stream` is rendered as **plain text** by the default UI
(never `dangerouslySetInnerHTML`). The reference CLI runner sanitizes the CLI's
stderr (redacts JWT/key/path patterns) before forwarding any error.

## Operational warnings

- **Don't expose `/login/start` to unauthenticated or CSRF-able callers** — an
  attacker who could start a device login and read the `userCode` could attempt
  their own approval flow. Keep the contract behind your normal app session.
- Add rate limiting to `/login/start` and `/run/stream` to prevent quota burn
  (the reference backend leaves this as an integration point).
- The persisted browser session marker stores only `{ loggedIn, savedAt }` by
  default — the account email is **not** persisted (opt in via `persistAccount`),
  to avoid PII readable by an XSS.

## Reporting

Found an issue? Open a private security advisory rather than a public issue.
