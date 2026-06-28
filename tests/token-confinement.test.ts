// @vitest-environment node
import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { createCodexRouter } from "../src/backend/express/createCodexRouter.js";
import type { CodexRunner, SessionCtx } from "../src/backend/types.js";
import type { RunStreamEvent } from "../src/core/contract.js";

const COOKIE_SECRET = "test-secret-of-sufficient-length-1234";
const SAME = { "Sec-Fetch-Site": "same-origin" };

// A runner that HOLDS tokens server-side (like the real CLI's auth.json) — the
// contract responses must NEVER leak any of these values to the client.
const SECRET_TOKENS = {
  access_token: "eyJSECRETACCESS.aaa.bbb",
  refresh_token: "refresh-SECRET-zzz",
  expires_at: "2026-01-01T00:00:00Z",
};

const leakyButContainedRunner: CodexRunner = {
  async startDeviceLogin(ctx: SessionCtx) {
    // store tokens server-side, as a real runner would
    ctx.data.tokens = SECRET_TOKENS;
    return { loginUrl: "https://auth.openai.com/x", userCode: "AAAA-BBBB", expiresAt: 1 };
  },
  async getStatus(ctx: SessionCtx) {
    void ctx;
    return { ok: true, account: "user@example.com" };
  },
  async *run(): AsyncIterable<RunStreamEvent> {
    yield { type: "assistant-text", mode: "append", text: "ok" };
    yield { type: "done", result: { text: "ok" } };
  },
  async logout() {},
};

function app() {
  const a = express();
  a.use("/api/codex", createCodexRouter({ runner: leakyButContainedRunner, cookieSecret: COOKIE_SECRET }));
  return a;
}

function assertNoTokens(text: string) {
  expect(text).not.toContain(SECRET_TOKENS.access_token);
  expect(text).not.toContain(SECRET_TOKENS.refresh_token);
  expect(text).not.toContain(SECRET_TOKENS.expires_at);
  expect(text.toLowerCase()).not.toContain("access_token");
  expect(text.toLowerCase()).not.toContain("refresh_token");
}

describe("token confinement — tokens never reach the client", () => {
  it("no token appears in any contract response body", async () => {
    const agent = request.agent(app());
    const session = await agent.post("/api/codex/session").set(SAME);
    assertNoTokens(session.text);

    const start = await agent.post("/api/codex/login/start").set(SAME);
    assertNoTokens(start.text);

    const status = await agent.get("/api/codex/status");
    assertNoTokens(status.text);

    const run = await agent.post("/api/codex/run/stream").set(SAME).send({ prompt: "hi" });
    assertNoTokens(run.text);

    const logout = await agent.post("/api/codex/logout").set(SAME);
    assertNoTokens(logout.text);
  });

  it("no token appears in Set-Cookie headers", async () => {
    const res = await request(app()).post("/api/codex/session").set(SAME);
    const cookies = (res.headers["set-cookie"] as unknown as string[]).join(";");
    assertNoTokens(cookies);
  });
});
