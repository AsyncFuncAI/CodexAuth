// codex-auth — public API barrel.
export { CodexAuth } from "./react/CodexAuth.js";
export type { CodexAuthProps } from "./react/CodexAuth.js";
export { useCodexAuth } from "./react/useCodexAuth.js";
export { OpenAIIcon } from "./react/ui/OpenAIIcon.js";
export type {
  UseCodexAuthOptions,
  UseCodexAuthResult,
} from "./react/useCodexAuth.js";
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
