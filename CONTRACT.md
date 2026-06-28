# The `/api/codex/*` HTTP contract

`<CodexAuth>` talks to a backend over this small contract. The reference backend
(`codex-auth/backend`) implements it in Node + Express, but you can implement it
in **any language** — this document is the spec. The base path defaults to
`/api/codex` and is configurable.

**Invariant:** no response in this contract ever contains an OAuth `access_token`,
`refresh_token`, or `expires_at`. Tokens live only on the backend.

All requests carry the backend session via an `HttpOnly` cookie. State-changing
requests (`POST`) must be CSRF-protected (see `SECURITY.md`).

---

## `POST {basePath}/session`

Provision or reuse a backend session. **Must be idempotent** — the client always
calls it (it cannot read the `HttpOnly` cookie to decide whether one exists).

- **Request:** empty body; cookies sent.
- **Response:** `{ "ok": true }` (sets/refreshes the session cookie) or
  `{ "ok": false, "error": "<message>" }`.

## `POST {basePath}/login/start`

Start the device-code flow. Requires a session cookie.

- **Request:** empty body.
- **Response (one of):**
  - `{ "ok": true, "loggedIn": true }` — already authenticated; client skips the popup.
  - `{ "loginUrl": "https://auth.openai.com/…", "userCode": "BNPY-MZ5DA", "expiresAt": 1750000000000 }`
    — point the popup at `loginUrl`, show `userCode`. `expiresAt` is **absolute epoch milliseconds**.
  - `{ "errorCode": "DEVICE_AUTH_NOT_ENABLED" }` — user must enable device auth in ChatGPT.
  - `{ "error": "<message>" }` — other failure.

## `GET {basePath}/status`

Polling target. Polled every `pollIntervalMs` (default 3000ms) until `ok`.

- **Request:** session cookie.
- **Response:**
  - `{ "ok": true, "account": "user@example.com" }` — authenticated. `account` is an email or display name. **Never** a token.
  - `{ "ok": false, "status": "pending" }` — not yet authenticated. **Does not** sign the user out.
  - **Definitive logged-out:** HTTP `401`, or `{ "ok": false, "status": "logged_out" }`. Only these sign the user out.
  - Transient errors (`5xx`/network) are tolerated by the client with bounded backoff.

## `POST {basePath}/run/stream`

Run a prompt; stream the result as NDJSON. Requires a session cookie.

- **Request body:** `{ "prompt": "<text>" }`  ← the wire field is `prompt`.
- **Response:** `Content-Type: application/x-ndjson`, one JSON object per line:
  - `{ "type": "assistant-text", "mode": "append" | "replace", "text": "…" }`
  - `{ "type": "done", "result": { "text": "<final>" } }`
  - `{ "type": "error", "error": "<message>" }`
- The backend should kill the underlying run when the client disconnects.

## `POST {basePath}/logout`

Clear the backend session and tokens. Requires a session cookie.

- **Request:** empty body.
- **Response:** `{}` (200), and clears the session cookie (`Max-Age=0`).

---

## Notes for backend implementers

- The reference backend shells out to the official `codex` CLI:
  `codex login --device-auth`, `codex login status`, `codex exec --json`, `codex logout`.
- An alternative backend can implement the device-code grant directly against
  `https://auth.openai.com/oauth/{authorize,token}` with PKCE (S256), the public
  Codex client id `app_EMoamEEZ73f0CkXaXp7hrann`, scope
  `openid profile email offline_access`, and params `id_token_add_organizations=true`,
  `codex_cli_simplified_flow=true`. Keep the resulting token bundle server-side.
