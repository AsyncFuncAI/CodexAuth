import type {
  CodexClientConfig,
  EndpointMap,
  RunStreamEvent,
} from "./contract.js";
import { resolveEndpoints } from "./endpoints.js";
import { readNdjsonStream } from "./stream.js";

export interface RunHandlers {
  /** Called for each assistant-text chunk. `mode` is append or replace. */
  onText?: (text: string, mode: "append" | "replace") => void;
  onDone?: (result: { text: string }) => void;
  /** Backend-emitted stream error (distinct from a transport failure). */
  onError?: (error: string) => void;
}

export interface RunController {
  abort: () => void;
  /** Resolves with the final accumulated text, or rejects on transport failure. */
  done: Promise<{ text: string }>;
}

interface RunDeps {
  endpoints: EndpointMap;
  fetchImpl: typeof fetch;
  credentials: RequestCredentials;
  maxStreamLineBytes?: number;
}

/**
 * Execute a prompt against the backend's /run/stream endpoint and stream the
 * result. The wire request body field is `prompt` (verified from app.js).
 */
export function runPrompt(
  prompt: string,
  handlers: RunHandlers,
  deps: RunDeps,
): RunController {
  const controller = new AbortController();
  let accumulated = "";

  const done = (async () => {
    const resp = await deps.fetchImpl(deps.endpoints.runStream, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt }),
      credentials: deps.credentials,
      signal: controller.signal,
    });

    if (!resp.ok || !resp.body) {
      let msg = `run failed with status ${resp.status}`;
      try {
        const data = (await resp.json()) as { error?: string };
        if (typeof data.error === "string") msg = data.error;
      } catch {
        /* keep default */
      }
      throw new Error(msg);
    }

    await readNdjsonStream(
      resp.body,
      {
        onEvent: (event: RunStreamEvent) => {
          if (event.type === "assistant-text") {
            accumulated =
              event.mode === "replace" ? event.text : accumulated + event.text;
            handlers.onText?.(event.text, event.mode);
          } else if (event.type === "done") {
            if (event.result?.text && event.result.text.trim()) {
              accumulated = event.result.text;
            }
            handlers.onDone?.({ text: accumulated });
          } else if (event.type === "error") {
            handlers.onError?.(event.error);
          }
        },
        onFailure: (m) => handlers.onError?.(m),
      },
      { maxLineBytes: deps.maxStreamLineBytes },
    );

    return { text: accumulated };
  })();

  return { abort: () => controller.abort(), done };
}

/**
 * Standalone run client (the `codex-auth/run` subpath). Lets a consumer run
 * prompts against an already-authenticated backend without the auth UI.
 */
export function createRunClient(config: CodexClientConfig = {}) {
  const endpoints = resolveEndpoints(config);
  const fetchImpl = config.fetch ?? globalThis.fetch.bind(globalThis);
  const credentials = config.credentials ?? "same-origin";
  return {
    run(prompt: string, handlers: RunHandlers = {}): RunController {
      return runPrompt(prompt, handlers, {
        endpoints,
        fetchImpl,
        credentials,
        maxStreamLineBytes: config.maxStreamLineBytes,
      });
    },
  };
}
