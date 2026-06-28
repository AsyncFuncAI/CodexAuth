import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
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
  /** Model passed to `codex exec -m <model>`. Omit to use the CLI default. */
  model?: string;
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
      // NB: "Not logged in" contains "logged in" — must exclude the negative case.
      const loggedIn = /logged in/i.test(out) && !/not logged in/i.test(out);
      if (loggedIn) {
        // `codex login status` does not print the email, but ~/.codex/auth.json
        // holds an id_token whose claims include email + name. We decode those
        // identity claims SERVER-SIDE and return only the email/name — never a token.
        const account =
          (await accountFromAuthJson(baseEnv)) ?? extractAccount(out) ?? "ChatGPT account";
        return { ok: true, account };
      }
      return { ok: false, status: "pending" };
    },

    async *run(ctx: SessionCtx, prompt: string, signal?: AbortSignal): AsyncIterable<RunStreamEvent> {
      void ctx;
      const args = ["exec", "--json"];
      if (opts.model) args.push("-m", opts.model);
      args.push("-");
      const proc = spawn(bin, args, { cwd: opts.cwd, env: baseEnv });

      // ALWAYS attach an error handler. When the client disconnects we kill the
      // child ourselves; the resulting ChildProcess 'error' (ABORT_ERR) must be
      // swallowed or Node throws an uncaught exception and crashes the server.
      proc.on("error", () => {});

      // Kill the child if the client disconnects (signal aborts) — no orphan spend.
      const onAbort = () => {
        try {
          proc.kill("SIGTERM");
        } catch {
          /* already gone */
        }
      };
      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }

      proc.stdin?.on("error", () => {}); // EPIPE if the child exits early
      proc.stdin?.write(prompt);
      proc.stdin?.end();

      try {
        yield* parseExecJsonl(proc);
      } finally {
        if (signal) signal.removeEventListener("abort", onAbort);
      }
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
      buf += stripAnsi(d.toString());
      // Verified format (codex-cli 0.141.0):
      //   https://auth.openai.com/codex/device
      //   one-time code: BPZ8-ZO6GV   (4 chars, dash, 4-6 chars)
      const url = buf.match(/https:\/\/auth\.openai\.com\/\S+/)?.[0];
      const code = buf.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4,6}\b/)?.[0];
      if (url && code) {
        cleanup();
        resolve({
          loginUrl: stripTrailingPunctuation(url),
          userCode: code,
          // The CLI prints "(expires in 15 minutes)"; device codes are ~15min.
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

/**
 * Translate `codex exec --json` JSONL into our RunStreamEvent shape.
 *
 * Consumes the child's stdout as an async iterable (Node streams are async
 * iterable since v10), splitting on newlines. This avoids the lost-wakeup races
 * of a hand-rolled queue. We also drain stderr so a CLI error surfaces instead
 * of hanging silently.
 */
async function* parseExecJsonl(
  proc: ReturnType<typeof spawn>,
): AsyncIterable<RunStreamEvent> {
  const stdout = proc.stdout;
  if (!stdout) {
    yield { type: "error", error: "codex produced no output stream" };
    return;
  }

  // Collect stderr for diagnostics if the run produces nothing useful.
  let stderrText = "";
  proc.stderr?.on("data", (d: Buffer) => (stderrText += d.toString()));

  let buffer = "";
  let sawAny = false;

  try {
    for await (const chunk of stdout as AsyncIterable<Buffer>) {
      buffer += chunk.toString();
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const event = mapCodexEvent(line);
        if (event) {
          sawAny = true;
          yield event;
        }
      }
    }
    // flush a final partial line
    const tail = buffer.trim();
    if (tail) {
      const event = mapCodexEvent(tail);
      if (event) {
        sawAny = true;
        yield event;
      }
    }
  } catch (e) {
    yield { type: "error", error: sanitize(e instanceof Error ? e.message : "stream read error") };
    return;
  }

  if (!sawAny) {
    // The CLI exited without an agent message — surface why (sanitized).
    const msg = sanitize(stderrText.trim()) || "codex exec produced no assistant message";
    yield { type: "error", error: msg };
  }
}

/**
 * Map a single `codex exec --json` JSONL line to a RunStreamEvent.
 *
 * Verified event vocabulary (codex-cli 0.141.0):
 *   {"type":"thread.started", ...}
 *   {"type":"turn.started"}
 *   {"type":"item.started",   "item":{ "type":"command_execution"|... }}
 *   {"type":"item.completed", "item":{ "type":"agent_message", "text":"..." }}
 *   {"type":"item.completed", "item":{ "type":"error", "message":"..." }}   ← noise, not fatal
 *   {"type":"turn.completed", "usage":{...}}
 *
 * The assistant's answer is the `agent_message` item's text. We send it as a
 * `replace` so the UI shows the final message cleanly. We ignore tool/command
 * items and non-fatal `error` items (e.g. the skills-budget warning), and emit
 * a `done` on `turn.completed`.
 */
function mapCodexEvent(line: string): RunStreamEvent | null {
  let obj: any;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }
  const type: string = obj.type ?? "";

  if (type === "item.completed" || type === "item.updated") {
    const item = obj.item ?? {};
    if (item.type === "agent_message" && item.text) {
      // The final assistant message — replace so partial/tool noise is overwritten.
      return { type: "assistant-text", mode: "replace", text: String(item.text) };
    }
    // command_execution / reasoning / non-fatal error items are not surfaced.
    return null;
  }

  if (type === "turn.completed") {
    return { type: "done", result: { text: "" } };
  }

  // A turn-level failure is a real error; item-level "error" items are noise.
  if (type === "turn.failed" || type === "error") {
    const msg = obj.error?.message ?? obj.message ?? "run failed";
    return { type: "error", error: sanitize(String(msg)) };
  }

  return null;
}

function extractAccount(out: string): string | null {
  // e.g. "Logged in using ChatGPT (you@example.com)" if the CLI includes it.
  const email = out.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0];
  return email ?? null;
}

/**
 * Read the user's display identity from the CLI's auth.json id_token claims.
 * Returns the email (preferred) or name, or null. Only identity claims are read;
 * the tokens themselves are never returned or logged.
 */
async function accountFromAuthJson(env: NodeJS.ProcessEnv): Promise<string | null> {
  const home = env.CODEX_HOME ?? join(env.HOME ?? homedir(), ".codex");
  try {
    const raw = await readFile(join(home, "auth.json"), "utf8");
    const idToken: string | undefined = JSON.parse(raw)?.tokens?.id_token;
    if (!idToken) return null;
    const payload = idToken.split(".")[1];
    if (!payload) return null;
    const json = Buffer.from(
      payload.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
    const claims = JSON.parse(json) as { email?: string; name?: string };
    return claims.email ?? claims.name ?? null;
  } catch {
    return null;
  }
}

function stripTrailingPunctuation(url: string): string {
  return url.replace(/[).,]+$/, "");
}

// Strip ANSI SGR color sequences (ESC[ ... m). Built from the ESC code point so
// no literal control character lives in the source.
const ANSI_RE = new RegExp(String.fromCharCode(27) + "\[[0-9;]*m", "g");
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

/** Remove anything token-shaped from CLI output before forwarding to the client. */
function sanitize(text: string): string {
  return text
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted-jwt]")
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "[redacted-key]")
    .replace(/\/[^\s]*auth\.json/g, "[redacted-path]");
}
