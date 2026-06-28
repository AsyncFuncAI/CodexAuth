/**
 * codex-auth/backend/next — Next.js App Router adapter.
 *
 * Bridges the framework-neutral handler to Next.js Web `Request`/`Response`.
 * IMPORTANT: this must run on the Node.js runtime (not edge), because the
 * default CLI runner spawns the `codex` binary. In your route file add:
 *
 *   export const runtime = "nodejs";
 *
 * Usage — app/api/codex/[...codex]/route.ts:
 *
 *   import { createNextCodexHandler, defaultCliRunner } from "codex-auth/backend/next";
 *   export const runtime = "nodejs";
 *   export const { GET, POST } = createNextCodexHandler({
 *     runner: defaultCliRunner({ model: "gpt-5.5" }),
 *     cookieSecret: process.env.COOKIE_SECRET!,
 *     basePath: "/api/codex",
 *   });
 */
import { handleCodexRequest, type CodexHandlerOptions } from "../core/handler.js";

type NextHandler = (req: Request) => Promise<Response>;

export function createNextCodexHandler(
  options: CodexHandlerOptions,
): { GET: NextHandler; POST: NextHandler } {
  const handler: NextHandler = (req) => handleCodexRequest(req, options);
  return { GET: handler, POST: handler };
}

export { defaultCliRunner } from "../express/cliRunner.js";
export type { CliRunnerOptions } from "../express/cliRunner.js";
export { createMemorySessionStore } from "../express/sessionStore.js";
export type {
  CodexRunner,
  SessionCtx,
  StartDeviceLoginResult,
  GetStatusResult,
} from "../types.js";
export type { CodexHandlerOptions } from "../core/handler.js";
