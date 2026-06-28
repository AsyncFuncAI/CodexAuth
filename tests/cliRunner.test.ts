// @vitest-environment node
import { describe, it, expect } from "vitest";
import { mapCodexEvent } from "../src/backend/express/cliRunner.js";

describe("mapCodexEvent (codex exec --json vocab)", () => {
  it("maps item.completed agent_message → assistant-text replace", () => {
    const e = mapCodexEvent(
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Salt wind" } }),
    );
    expect(e).toEqual({ type: "assistant-text", mode: "replace", text: "Salt wind" });
  });

  it("maps item.updated agent_message → assistant-text replace", () => {
    const e = mapCodexEvent(
      JSON.stringify({ type: "item.updated", item: { type: "agent_message", text: "partial" } }),
    );
    expect(e?.type).toBe("assistant-text");
  });

  it("ignores command_execution items (tool noise)", () => {
    expect(
      mapCodexEvent(JSON.stringify({ type: "item.completed", item: { type: "command_execution" } })),
    ).toBeNull();
  });

  it("ignores item-level error items (non-fatal, e.g. skills-budget warning)", () => {
    expect(
      mapCodexEvent(JSON.stringify({ type: "item.completed", item: { type: "error", message: "warn" } })),
    ).toBeNull();
  });

  it("maps turn.completed → done (text filled by the generator)", () => {
    expect(mapCodexEvent(JSON.stringify({ type: "turn.completed", usage: {} }))).toEqual({
      type: "done",
      result: { text: "" },
    });
  });

  it("maps turn.failed → error", () => {
    const e = mapCodexEvent(JSON.stringify({ type: "turn.failed", error: { message: "boom" } }));
    expect(e).toEqual({ type: "error", error: "boom" });
  });

  it("ignores thread.started / turn.started", () => {
    expect(mapCodexEvent(JSON.stringify({ type: "thread.started" }))).toBeNull();
    expect(mapCodexEvent(JSON.stringify({ type: "turn.started" }))).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(mapCodexEvent("not json")).toBeNull();
  });
});
