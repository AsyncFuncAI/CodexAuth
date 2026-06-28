// codex-auth — public API barrel. (React layer is added in U9.)
export { createCodexClient } from "./core/createCodexClient.js";
export type { CodexClient } from "./core/createCodexClient.js";
export { resolveEndpoints, DEFAULT_BASE_PATH } from "./core/endpoints.js";
export { transition, initialSnapshot } from "./core/stateMachine.js";
export type { CodexAuthEvent } from "./core/stateMachine.js";
export {
  openBlankPopup,
  writeHoldingScreen,
  assertSafeLoginUrl,
  pointPopupTo,
  closePopup,
  isClosed,
} from "./core/popup.js";
export { createRunClient, runPrompt } from "./core/run.js";
export type { RunHandlers, RunController } from "./core/run.js";

export type {
  CodexClientConfig,
  CodexAuthStatus,
  CodexAuthSnapshot,
  CodexAuthError,
  CodexAuthErrorCode,
  EndpointMap,
  StorageLike,
  SessionResponse,
  LoginStartResponse,
  LoginStartPending,
  StatusResponse,
  RunStreamEvent,
  RunRequest,
  LogoutResponse,
} from "./core/contract.js";
