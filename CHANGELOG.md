# Changelog

## 0.1.0

Initial release.

- `<CodexAuth>` React component (default styled UI + headless render-prop API).
- `useCodexAuth()` hook and framework-agnostic `createCodexClient()` core.
- Device-code "Login with ChatGPT" flow with the synchronous-blank-popup trick,
  device-code card, status polling, 24h session resume, and account console.
- `codex-auth/run` — standalone prompt-execution client.
- `codex-auth/backend` — reference Express router (`createCodexRouter`) + a Codex
  CLI runner (`defaultCliRunner`), with hardened cookies, CSRF and CORS handling,
  and a token-confinement guarantee (tokens never reach the browser).
- Runnable Vite + Express demo.
- 79 tests.

### Deferred to a future release
- Cloudflare Worker edge variant (documented as a reverse-proxy note).
- Direct device-code-grant backend (no CLI shell-out).
- Built-in rate limiting and an exhaustive React 17/18/19 CI matrix.
