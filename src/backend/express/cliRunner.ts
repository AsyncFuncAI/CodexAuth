import { spawn } from "node:child_process";
import type { RunStreamEvent } from "../../core/contract.js";
import type {
  CodexRunner,
  SessionCtx,
  StartDeviceLoginResult,
  GetStatusResult,
} from "../types.js";

export interface CliRunnerOptions {
  /** Path/name of the codex binary. Default "codex". */
  codexBin?: string;
  cwd?: string;
  /** Extra env for the spawned process (e.g. a per-session CODEX_HOME). */
  env?: NodeJS.ProcessEnv;
}

/**
 * Reference CodexRunner that shells out to the official `codex` CLI.
 *
 * Verified CLI surface (codex-cli 0.141.0):
 *   - `codex login --device-auth`   → device-code flow; prints a login URL + user code
 *   - `codex login status`          → "Logged in using ChatGPT" when authenticated
 *   - `codex exec --json "<prompt>"`→ JSONL events on stdout
 *   - `codex logout`                → clears ~/.codex/auth.json
 *
 * Tokens live in the CLI's auth.json (server-side) and NEVER reach the client.
 * The device-login stdout parsing is isolated here so it can be adjusted against
 * the installed CLI version without touching the rest of the package.
 */
export function defaultCliRunner(opts: CliRunnerOptions = {}): CodexRunner {
  const bin = opts.codexBin ?? "codex";
  const baseEnv = { ...process.env, ...opts.env };

  function exec(
    args: string[],
    { signal, input }: { signal?: AbortSignal; input?: string } = {},
  ): { proc: ReturnType<typeof spawn>; stdout: Promise<string>; stderr: Promise<string> } {
    const proc = spawn(bin, args, { cwd: opts.cwd, env: baseEnv, signal });
    if (input != null) {
      proc.stdin?.write(input);
      proc.stdin?.end();
    }
    const stdout = collect(proc.stdout);
    const stderr = collect(proc.stderr);
    return { proc, stdout, stderr };
  }

  return {
    async startDeviceLogin(ctx: SessionCtx): Promise<StartDeviceLoginResult> {
      // Already logged in?
      const status = await this.getStatus(ctx);
      if (status.ok) return { loggedIn: true };

      // Kick off the device-auth flow. We read stdout until we see the login URL
      // + user code, then keep the process alive in the session (the CLI polls
      // OpenAI itself and writes auth.json on success).
      const { proc, stderr } = exec(["login", "--device-auth"]);
      const parsed = await readDeviceLoginInfo(proc).catch(() => null);

      if (!parsed) {
        const err = sanitize(await stderr);
        if (/device.?code|not enabled|security settings/i.test(err)) {
          proc.kill();
          return { errorCode: "DEVICE_AUTH_NOT_ENABLED" };
        }
        proc.kill();
        // Surface as not-enabled-style guidance rather than leaking stderr.
        return { errorCode: "DEVICE_AUTH_NOT_ENABLED" };
      }

      // Hold the process on the session so the CLI can finish the poll/exchange.
      ctx.data.loginProc = proc;
      return parsed;
    },

    async getStatus(ctx: SessionCtx): Promise<GetStatusResult> {
      void ctx;
      const { stdout, stderr } = exec(["login", "status"]);
      const out = (await stdout) + (await stderr);
      if (/logged in/i.test(out)) {
        const account = extractAccount(out) ?? "ChatGPT account";
        return { ok: true, account };
      }
      return { ok: false, status: "pending" };
    },

    async *run(ctx: SessionCtx, prompt: string, signal?: AbortSignal): AsyncIterable<RunStreamEvent> {
      void ctx;
      const proc = spawn(bin, ["exec", "--json", "-"], {
        cwd: opts.cwd,
        env: baseEnv,
        signal,
      });
      // Kill the child if the client disconnects (signal aborts) — no orphan spend.
      proc.stdin?.write(prompt);
      proc.stdin?.end();

      yield* parseExecJsonl(proc);
    },

    async logout(ctx: SessionCtx): Promise<void> {
      const proc = ctx.data.loginProc as ReturnType<typeof spawn> | undefined;
      proc?.kill();
      const { stdout } = exec(["logout"]);
      await stdout.catch(() => "");
    },
  };
}

// ---- parsing helpers (isolated so they can track CLI output changes) ----

function collect(stream: NodeJS.ReadableStream | null): Promise<string> {
  if (!stream) return Promise.resolve("");
  return new Promise((resolve) => {
    let buf = "";
    stream.on("data", (d) => (buf += d.toString()));
    stream.on("end", () => resolve(buf));
    stream.on("error", () => resolve(buf));
  });
}

/** Read stdout/stderr until the device login URL + user code appear. */
function readDeviceLoginInfo(
  proc: ReturnType<typeof spawn>,
): Promise<{ loginUrl: string; userCode: string; expiresAt: number }> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const onData = (d: Buffer) => {
      buf += d.toString();
      const url = buf.match(/https:\/\/auth\.openai\.com\/\S+/)?.[0];
      // user codes look like XXXX-XXXX
      const code = buf.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/)?.[0];
      if (url && code) {
        cleanup();
        resolve({
          loginUrl: stripTrailingPunctuation(url),
          userCode: code,
          // The CLI does not always print an expiry; device codes are ~15min.
          expiresAt: Date.now() + 15 * 60 * 1000,
        });
      }
    };
    const onClose = () => {
      cleanup();
      reject(new Error("device login process closed before emitting a code"));
    };
    const cleanup = () => {
      proc.stdout?.off("data", onData);
      proc.stderr?.off("data", onData);
      proc.off("close", onClose);
    };
    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);
    proc.on("close", onClose);
  });
}

/** Translate `codex exec --json` JSONL into our RunStreamEvent shape. */
async function* parseExecJsonl(
  proc: ReturnType<typeof spawn>,
): AsyncIterable<RunStreamEvent> {
  const stdout = proc.stdout;
  if (!stdout) return;
  let buffer = "";
  const queue: RunStreamEvent[] = [];
  let resolveNext: (() => void) | null = null;
  let ended = false;

  const push = (e: RunStreamEvent) => {
    queue.push(e);
    resolveNext?.();
  };

  stdout.on("data", (d: Buffer) => {
    buffer += d.toString();
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const event = mapCodexEvent(line);
      if (event) push(event);
    }
  });
  const finish = () => {
    if (buffer.trim()) {
      const event = mapCodexEvent(buffer.trim());
      if (event) push(event);
    }
    ended = true;
    resolveNext?.();
  };
  stdout.on("end", finish);
  stdout.on("error", finish);
  proc.on("close", finish);

  for (;;) {
    if (queue.length) {
      yield queue.shift()!;
      continue;
    }
    if (ended) return;
    await new Promise<void>((r) => (resolveNext = r));
    resolveNext = null;
  }
}

/**
 * Map a single `codex exec --json` JSONL line to a RunStreamEvent. The CLI's
 * event vocabulary varies by version; we extract assistant text and a final
 * result defensively, ignoring unrecognized events.
 */
function mapCodexEvent(line: string): RunStreamEvent | null {
  let obj: any;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }
  const type: string = obj.type ?? obj.msg?.type ?? "";

  // Streaming assistant deltas
  if (/agent_message_delta|assistant.*delta|output_text\.delta/i.test(type)) {
    const text = obj.delta ?? obj.text ?? obj.msg?.delta ?? "";
    if (text) return { type: "assistant-text", mode: "append", text: String(text) };
  }
  // Full assistant message
  if (/agent_message$|assistant_message|message$/i.test(type)) {
    const text = obj.message ?? obj.text ?? obj.msg?.message ?? "";
    if (text) return { type: "assistant-text", mode: "replace", text: String(text) };
  }
  // Completion
  if (/task_complete|turn.*complete|result|done/i.test(type)) {
    const text = obj.result?.text ?? obj.text ?? obj.message ?? "";
    return { type: "done", result: { text: String(text || "") } };
  }
  // Errors
  if (/error/i.test(type)) {
    return { type: "error", error: sanitize(String(obj.message ?? obj.error ?? "error")) };
  }
  return null;
}

function extractAccount(out: string): string | null {
  // e.g. "Logged in using ChatGPT (you@example.com)" if the CLI includes it.
  const email = out.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0];
  return email ?? null;
}

function stripTrailingPunctuation(url: string): string {
  return url.replace(/[).,]+$/, "");
}

/** Remove anything token-shaped from CLI output before forwarding to the client. */
function sanitize(text: string): string {
  return text
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted-jwt]")
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "[redacted-key]")
    .replace(/\/[^\s]*auth\.json/g, "[redacted-path]");
}
