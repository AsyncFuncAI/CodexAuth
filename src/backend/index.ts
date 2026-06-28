// codex-auth/backend — Node-only reference backend. Never import this from
// browser code; it pulls express + node:child_process.
//
// Adapters:
//   codex-auth/backend         → Express + the framework-neutral handler (this file)
//   codex-auth/backend/next    → Next.js App Router route handler
//   codex-auth/backend/worker  → Cloudflare Worker (proxy-only)
export { createCodexRouter } from "./express/createCodexRouter.js";
export type { CodexRouterOptions } from "./express/createCodexRouter.js";
export { handleCodexRequest } from "./core/handler.js";
export type { CodexHandlerOptions, CookieAttributes } from "./core/handler.js";
export { defaultCliRunner, killLoginProc } from "./express/cliRunner.js";
export type { CliRunnerOptions } from "./express/cliRunner.js";
export { createMemorySessionStore } from "./core/sessionStore.js";
export type { SessionStore } from "./core/sessionStore.js";
export type {
  CodexRunner,
  SessionCtx,
  StartDeviceLoginResult,
  GetStatusResult,
} from "./types.js";
