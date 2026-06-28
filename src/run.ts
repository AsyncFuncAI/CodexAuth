// codex-auth/run — standalone prompt-execution client (no auth UI).
export { createRunClient, runPrompt } from "./core/run.js";
export type { RunHandlers, RunController } from "./core/run.js";
export type { RunStreamEvent, RunRequest } from "./core/contract.js";
