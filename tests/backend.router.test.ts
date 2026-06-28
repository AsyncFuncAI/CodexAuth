// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { createCodexRouter } from "../src/backend/express/createCodexRouter.js";
import { createMemorySessionStore } from "../src/backend/express/sessionStore.js";
import type { CodexRunner, SessionCtx } from "../src/backend/types.js";
import type { RunStreamEvent } from "../src/core/contract.js";

const COOKIE_SECRET = "test-secret-of-sufficient-length-1234";

function makeRunner(over: Partial<CodexRunner> = {}): CodexRunner {
  return {
    async startDeviceLogin() {
      return { loginUrl: "https://auth.openai.com/x", userCode: "AAAA-BBBB", expiresAt: 1 };
    },
    async getStatus() {
      return { ok: true, account: "user@example.com" };
    },
    async *run(_ctx: SessionCtx, _prompt: string): AsyncIterable<RunStreamEvent> {
      yield { type: "assistant-text", mode: "append", text: "hi" };
      yield { type: "done", result: { text: "hi" } };
    },
    async logout() {},
    ...over,
  };
}

function app(runner: CodexRunner, allowedOrigins?: string[]) {
  const a = express();
  a.use(
    "/api/codex",
    createCodexRouter({
      runner,
      cookieSecret: COOKIE_SECRET,
      sessionStore: createMemorySessionStore(),
      allowedOrigins,
      // The supertest agent runs over plain HTTP and will not echo Secure cookies,
      // so disable Secure for the test harness only (production keeps the default).
      cookieOptions: { secure: false },
    }),
  );
  return a;
}

// supertest sends same-origin-ish requests; emulate a browser fetch by adding
// Sec-Fetch-Site: same-origin so the CSRF guard admits the request.
const SAME = { "Sec-Fetch-Site": "same-origin" };

describe("createCodexRouter", () => {
  it("rejects a too-short cookieSecret", () => {
    expect(() => createCodexRouter({ runner: makeRunner(), cookieSecret: "short" })).toThrow();
  });

  it("POST /session sets a signed HttpOnly Secure SameSite=Strict cookie", async () => {
    // Use a router with the DEFAULT (hardened) cookie attrs to assert Secure is present.
    const secureApp = express();
    secureApp.use(
      "/api/codex",
      createCodexRouter({ runner: makeRunner(), cookieSecret: COOKIE_SECRET }),
    );
    const res = await request(secureApp).post("/api/codex/session").set(SAME);
    expect(res.body).toEqual({ ok: true });
    const cookie = (res.headers["set-cookie"] as unknown as string[])[0]!;
    expect(cookie).toMatch(/codex_sid=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Strict/);
  });

  it("POST /session is idempotent (reuses the session)", async () => {
    const agent = request.agent(app(makeRunner()));
    const r1 = await agent.post("/api/codex/session").set(SAME);
    const r2 = await agent.post("/api/codex/session").set(SAME);
    expect(r1.body.ok).toBe(true);
    expect(r2.body.ok).toBe(true);
  });

  it("login/start returns pending shape", async () => {
    const agent = request.agent(app(makeRunner()));
    await agent.post("/api/codex/session").set(SAME);
    const res = await agent.post("/api/codex/login/start").set(SAME);
    expect(res.body.userCode).toBe("AAAA-BBBB");
    expect(res.body.loginUrl).toContain("auth.openai.com");
  });

  it("login/start maps loggedIn:true", async () => {
    const runner = makeRunner({ async startDeviceLogin() { return { loggedIn: true }; } });
    const agent = request.agent(app(runner));
    await agent.post("/api/codex/session").set(SAME);
    const res = await agent.post("/api/codex/login/start").set(SAME);
    expect(res.body).toMatchObject({ ok: true, loggedIn: true });
  });

  it("login/start maps DEVICE_AUTH_NOT_ENABLED", async () => {
    const runner = makeRunner({ async startDeviceLogin() { return { errorCode: "DEVICE_AUTH_NOT_ENABLED" }; } });
    const agent = request.agent(app(runner));
    await agent.post("/api/codex/session").set(SAME);
    const res = await agent.post("/api/codex/login/start").set(SAME);
    expect(res.body).toEqual({ errorCode: "DEVICE_AUTH_NOT_ENABLED" });
  });

  it("GET /status with no session → 401 logged_out", async () => {
    const res = await request(app(makeRunner())).get("/api/codex/status");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ ok: false, status: "logged_out" });
  });

  it("GET /status returns {ok, account} only", async () => {
    const agent = request.agent(app(makeRunner()));
    await agent.post("/api/codex/session").set(SAME);
    const res = await agent.get("/api/codex/status");
    expect(res.body).toEqual({ ok: true, account: "user@example.com" });
  });

  it("run/stream emits NDJSON events", async () => {
    const agent = request.agent(app(makeRunner()));
    await agent.post("/api/codex/session").set(SAME);
    const res = await agent.post("/api/codex/run/stream").set(SAME).send({ prompt: "hello" });
    const lines = res.text.trim().split("\n").map((l) => JSON.parse(l));
    expect(lines[0]).toEqual({ type: "assistant-text", mode: "append", text: "hi" });
    expect(lines.at(-1)).toEqual({ type: "done", result: { text: "hi" } });
  });

  it("run/stream requires a prompt", async () => {
    const agent = request.agent(app(makeRunner()));
    await agent.post("/api/codex/session").set(SAME);
    const res = await agent.post("/api/codex/run/stream").set(SAME).send({});
    expect(res.status).toBe(400);
  });

  it("logout clears the cookie", async () => {
    const agent = request.agent(app(makeRunner()));
    await agent.post("/api/codex/session").set(SAME);
    const res = await agent.post("/api/codex/logout").set(SAME);
    expect(res.body).toEqual({});
    expect((res.headers["set-cookie"] as unknown as string[])[0]!).toMatch(/Max-Age=0/);
  });
});
