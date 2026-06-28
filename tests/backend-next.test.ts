// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createNextCodexHandler } from "../src/backend/next/index.js";
import { createMemorySessionStore } from "../src/backend/core/sessionStore.js";
import type { CodexRunner } from "../src/backend/types.js";
import type { RunStreamEvent } from "../src/core/contract.js";

const runner: CodexRunner = {
  async startDeviceLogin() {
    return { loginUrl: "https://auth.openai.com/codex/device", userCode: "AAAA-BBBB", expiresAt: 1 };
  },
  async getStatus() {
    return { ok: true, account: "a@b.com" };
  },
  async *run(): AsyncIterable<RunStreamEvent> {},
  async logout() {},
};

describe("createNextCodexHandler", () => {
  const { GET, POST } = createNextCodexHandler({
    runner,
    cookieSecret: "test-secret-of-sufficient-length-1234",
    sessionStore: createMemorySessionStore(),
    cookieOptions: { secure: false },
  });

  it("exposes both GET and POST handlers", () => {
    expect(typeof GET).toBe("function");
    expect(typeof POST).toBe("function");
  });

  it("POST routes /session", async () => {
    const res = await POST(
      new Request("http://localhost/api/codex/session", {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin" },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("GET routes /status (401 without session)", async () => {
    const res = await GET(new Request("http://localhost/api/codex/status"));
    expect(res.status).toBe(401);
  });
});
