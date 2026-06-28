// codex-auth/backend/direct — a CodexRunner that calls OpenAI directly over HTTP
// (no `codex` CLI binary), so it runs on serverless platforms (Vercel, etc.).
//
//   import { createCodexRouter } from "codex-auth/backend";
//   import { directRunner } from "codex-auth/backend/direct";
//   createCodexRouter({ runner: directRunner(), cookieSecret: process.env.COOKIE_SECRET! });
export { directRunner } from "./directRunner.js";
export type { DirectRunnerOptions } from "./directRunner.js";
export {
  startDeviceAuth,
  pollDeviceAuth,
  refreshAccessToken,
  CLIENT_ID,
  DEVICE_VERIFICATION_URL,
} from "./oauth.js";
export type { OAuthCredentials, DeviceAuthStart, DevicePollResult } from "./oauth.js";
export { runDirect, resolveModels, RESPONSES_URL, MODELS_URL } from "./responses.js";
export type { DirectSession, RunDirectOptions } from "./responses.js";
