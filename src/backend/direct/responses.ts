/**
 * Call the Codex `responses` backend the way the CLI does, parse the SSE stream,
 * and yield our RunStreamEvent shape. Plus account-aware model resolution.
 *
 * NOTE: chatgpt.com/backend-api/codex/* is NOT a public/documented API — it is
 * OpenAI's first-party Codex tooling backend. We send the same headers the CLI
 * sends (incl. a codex-CLI User-Agent) so the request is accepted. See SECURITY.md
 * for the off-label-use caveats.
 */
import type { RunStreamEvent } from "../../core/contract.js";

const BACKEND_BASE = "https://chatgpt.com/backend-api/codex";
export const RESPONSES_URL = `${BACKEND_BASE}/responses`;
export const MODELS_URL = `${BACKEND_BASE}/models`;
export const ORIGINATOR = "codex_cli_rs";
/** Bump to match a recent Codex CLI release. */
export const CLI_VERSION = "0.111.0";
export const USER_AGENT = `codex_cli_rs/${CLI_VERSION} (Linux; x86_64) reqwest`;

// Models a ChatGPT-account (not API-key) Codex backend actually accepts. gpt-5.5
// is verified-accepted; gpt-5-codex / gpt-5 are rejected for ChatGPT accounts, so
// gpt-5.5 leads. Used only when account-aware /models discovery is blocked.
const FALLBACK_MODELS = ["gpt-5.5", "gpt-5.1", "gpt-5"];

export interface DirectSession {
  access: string;
  accountId: string;
}

function backendHeaders(session: DirectSession, accept: string): Record<string, string> {
  return {
    authorization: `Bearer ${session.access}`,
    "chatgpt-account-id": session.accountId,
    originator: ORIGINATOR,
    "user-agent": USER_AGENT,
    "x-codex-version": CLI_VERSION,
    "openai-beta": "responses=experimental",
    accept,
  };
}

const isCfChallenge = (status: number, body: string): boolean =>
  status === 403 ||
  status === 503 ||
  /_cf_chl_opt|cf-chl|challenge-platform|Just a moment/i.test(body);

/**
 * Resolve the model slugs this account may use. Falls back to known candidates
 * when discovery is blocked (e.g. a Cloudflare challenge from a datacenter IP).
 * An explicit `configured` list overrides discovery.
 */
export async function resolveModels(
  session: DirectSession,
  configured: string[] | undefined,
  f: typeof fetch,
): Promise<string[]> {
  if (configured && configured.length) return configured;
  try {
    const res = await f(`${MODELS_URL}?client_version=${encodeURIComponent(CLI_VERSION)}`, {
      headers: backendHeaders(session, "application/json"),
    });
    const body = await res.text();
    if (!res.ok) {
      if (isCfChallenge(res.status, body)) return FALLBACK_MODELS;
      return FALLBACK_MODELS;
    }
    const json = JSON.parse(body) as { models?: { slug?: unknown }[] };
    const slugs = (json.models ?? [])
      .map((m) => m.slug)
      .filter((s): s is string => typeof s === "string" && s.length > 0);
    return slugs.length ? slugs : FALLBACK_MODELS;
  } catch {
    return FALLBACK_MODELS;
  }
}

function buildPayload(model: string, prompt: string, effort: string): Record<string, unknown> {
  const isReasoning = /^(gpt-5|o[0-9]|codex)/.test(model);
  const p: Record<string, unknown> = {
    model,
    instructions: "You are a helpful assistant.",
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: prompt }] }],
    tools: [],
    tool_choice: "auto",
    parallel_tool_calls: false,
    store: false,
    stream: true,
    include: [],
  };
  if (isReasoning && effort !== "") p.reasoning = { effort, summary: "auto" };
  return p;
}

export interface RunDirectOptions {
  prompt: string;
  models?: string[];
  effort?: string;
  signal?: AbortSignal;
}

/**
 * Run a prompt against the Codex responses backend, trying the account's models
 * (and degrading reasoning effort) until one is accepted, then stream the text
 * deltas as RunStreamEvents.
 */
export async function* runDirect(
  session: DirectSession,
  opts: RunDirectOptions,
  f: typeof fetch,
): AsyncIterable<RunStreamEvent> {
  const effort = ["minimal", "low", "medium", "high"].includes(opts.effort ?? "")
    ? (opts.effort as string)
    : "low";
  const candidates = await resolveModels(session, opts.models, f);

  let upstream: Response | null = null;
  let lastDetail = "";
  let lastStatus = 0;

  for (const model of candidates) {
    const effortChain = effort === "minimal" || effort === "low" ? [effort, ""] : [effort, "low", "minimal", ""];
    let modelReject = false;
    for (const effortTry of effortChain) {
      const res = await f(RESPONSES_URL, {
        method: "POST",
        headers: { ...backendHeaders(session, "text/event-stream"), "content-type": "application/json" },
        body: JSON.stringify(buildPayload(model, opts.prompt, effortTry)),
        signal: opts.signal,
      });
      if (res.ok && res.body) {
        upstream = res;
        break;
      }
      lastStatus = res.status;
      lastDetail = await res.text().catch(() => "");
      if (res.status === 401) {
        yield { type: "error", error: "authentication failed (401)" };
        return;
      }
      if ((res.status === 400 || res.status === 403) && /effort|reasoning|summary/i.test(lastDetail)) {
        continue; // lower the effort
      }
      modelReject =
        (res.status === 400 && /not supported|does not exist|unknown model|invalid model|unsupported|not available/i.test(lastDetail)) ||
        (res.status === 403 && /model|not supported|not available|access|entitle|plan/i.test(lastDetail));
      break;
    }
    if (upstream) break;
    if (!modelReject) break; // a different error — stop and report
  }

  if (!upstream || !upstream.body) {
    yield { type: "error", error: `upstream error (${lastStatus})${lastDetail ? ": " + lastDetail.slice(0, 300) : ""}` };
    return;
  }

  // Parse SSE: response.output_text.delta -> assistant-text append.
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const evt of events) {
        for (const line of evt.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const json = JSON.parse(data) as { type?: string; delta?: string };
            if (json.type === "response.output_text.delta" && typeof json.delta === "string") {
              full += json.delta;
              yield { type: "assistant-text", mode: "append", text: json.delta };
            }
          } catch {
            /* keep-alive / non-json */
          }
        }
      }
    }
  } catch (e) {
    yield { type: "error", error: e instanceof Error ? e.message : "stream error" };
    return;
  }
  yield { type: "done", result: { text: full } };
}
