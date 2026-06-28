import { describe, it, expect, vi } from "vitest";
import { readNdjsonStream } from "../src/core/stream.js";
import type { RunStreamEvent } from "../src/core/contract.js";

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(enc.encode(chunks[i++]!));
      } else {
        controller.close();
      }
    },
  });
}

async function collect(chunks: string[], opts?: { maxLineBytes?: number }) {
  const events: RunStreamEvent[] = [];
  const failures: string[] = [];
  await readNdjsonStream(
    streamFromChunks(chunks),
    { onEvent: (e) => events.push(e), onFailure: (m) => failures.push(m) },
    opts,
  );
  return { events, failures };
}

describe("readNdjsonStream", () => {
  it("accumulates append events in order", async () => {
    const { events } = await collect([
      '{"type":"assistant-text","mode":"append","text":"Hel"}\n',
      '{"type":"assistant-text","mode":"append","text":"lo"}\n',
    ]);
    expect(events).toHaveLength(2);
    expect((events[0] as any).text).toBe("Hel");
    expect((events[1] as any).mode).toBe("append");
  });

  it("handles a line split across two chunks", async () => {
    const { events } = await collect([
      '{"type":"assistant-text","mode":"app',
      'end","text":"hi"}\n',
    ]);
    expect(events).toHaveLength(1);
    expect((events[0] as any).text).toBe("hi");
  });

  it("skips a malformed line but keeps later valid lines", async () => {
    const { events } = await collect([
      "not json at all\n",
      '{"type":"done","result":{"text":"ok"}}\n',
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("done");
  });

  it("flushes the final line when there is no trailing newline", async () => {
    const { events } = await collect(['{"type":"done","result":{"text":"end"}}']);
    expect(events).toHaveLength(1);
    expect((events[0] as any).result.text).toBe("end");
  });

  it("emits RUN_FAILED when a line exceeds the max length", async () => {
    const big = "x".repeat(100);
    const { failures } = await collect([big, big, big], { maxLineBytes: 50 });
    expect(failures.some((f) => f.startsWith("RUN_FAILED"))).toBe(true);
  });

  it("surfaces a backend error event distinctly from a transport failure", async () => {
    const onEvent = vi.fn();
    await readNdjsonStream(
      streamFromChunks(['{"type":"error","error":"backend boom"}\n']),
      { onEvent },
    );
    expect(onEvent).toHaveBeenCalledWith({ type: "error", error: "backend boom" });
  });
});
