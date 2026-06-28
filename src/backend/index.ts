// codex-auth/backend — Node-only reference backend (Express). Never import this
// from browser code; it pulls express + node:child_process.
export { createCodexRouter } from "./express/createCodexRouter.js";
export type { CodexRouterOptions } from "./express/createCodexRouter.js";
export { defaultCliRunner } from "./express/cliRunner.js";
export type { CliRunnerOptions } from "./express/cliRunner.js";
export { createMemorySessionStore } from "./express/sessionStore.js";
export type { SessionStore } from "./express/sessionStore.js";
export { enforceSameOrigin, corsForAllowedOrigins } from "./express/security.js";
export type {
  CodexRunner,
  SessionCtx,
  StartDeviceLoginResult,
  GetStatusResult,
} from "./types.js";
