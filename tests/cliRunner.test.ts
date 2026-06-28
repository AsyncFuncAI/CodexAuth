// @vitest-environment node
import { describe, it, expect } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultCliRunner, mapCodexEvent } from "../src/backend/express/cliRunner.js";
import type { SessionCtx } from "../src/backend/types.js";

describe("per-session CODEX_HOME isolation", () => {
  it("creates the session's CODEX_HOME dir before spawning (codex errors if it is missing)", async () => {
    const root = join(tmpdir(), `codex-auth-test-${Date.now()}`);
    // Use `true` as the binary so no real CLI runs; we only assert dir creation
    // happens as a side effect of building the per-session env.
    const runner = defaultCliRunner({ codexBin: "true", codexHomeRoot: root });
    const ctx: SessionCtx = { id: "sess-abc", data: {} };
    await runner.getStatus(ctx); // triggers envForSession → mkdir
    const home = ctx.data.codexHome as string;
    expect(home).toBe(join(root, "sess-abc"));
    expect(existsSync(home)).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("derives a distinct CODEX_HOME per session id", async () => {
    const root = join(tmpdir(), `codex-auth-test2-${Date.now()}`);
    const runner = defaultCliRunner({ codexBin: "true", codexHomeRoot: root });
    const a: SessionCtx = { id: "a", data: {} };
    const b: SessionCtx = { id: "b", data: {} };
    await runner.getStatus(a);
    await runner.getStatus(b);
    expect(a.data.codexHome).not.toBe(b.data.codexHome);
    rmSync(root, { recursive: true, force: true });
  });
});

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
