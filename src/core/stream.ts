import type { RunStreamEvent } from "./contract.js";

export interface StreamHandlers {
  onEvent: (event: RunStreamEvent) => void;
  /** Transport/parse failure distinct from a backend-emitted {type:'error'} event. */
  onFailure?: (message: string) => void;
}

const DEFAULT_MAX_LINE_BYTES = 1_048_576; // 1MB

/**
 * Read a fetch NDJSON body (one JSON RunStreamEvent per line) and dispatch each
 * event. Hardened per review:
 *   - caps line length to avoid unbounded-buffer DoS from a backend that never
 *     emits a newline (→ onFailure 'RUN_FAILED', stops reading)
 *   - wraps JSON.parse per line; a malformed line is SKIPPED, not fatal
 *   - flushes a non-empty trailing line at EOF (no trailing newline required)
 *
 * Returns a promise that resolves when the stream ends or is cancelled.
 */
export async function readNdjsonStream(
  body: ReadableStream<Uint8Array>,
  handlers: StreamHandlers,
  opts: { maxLineBytes?: number } = {},
): Promise<void> {
  const maxLineBytes = opts.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const dispatch = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      handlers.onEvent(JSON.parse(trimmed) as RunStreamEvent);
    } catch {
      // Malformed line — skip it, keep the run alive.
    }
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).replace(/\r$/, "");
        buffer = buffer.slice(nl + 1);
        dispatch(line);
      }

      if (buffer.length > maxLineBytes) {
        handlers.onFailure?.("RUN_FAILED: stream line exceeded maximum length");
        await reader.cancel().catch(() => {});
        return;
      }
    }
    // Flush any final partial line (EOF without trailing newline).
    buffer += decoder.decode();
    dispatch(buffer);
  } catch (e) {
    handlers.onFailure?.(
      e instanceof Error ? e.message : "RUN_FAILED: stream read error",
    );
  } finally {
    reader.releaseLock?.();
  }
}
