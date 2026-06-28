// @vitest-environment node
import { describe, it, expect } from "vitest";
import { handleCodexRequest } from "../src/backend/core/handler.js";
import { createMemorySessionStore } from "../src/backend/core/sessionStore.js";
import type { CodexRunner, SessionCtx } from "../src/backend/types.js";
import type { RunStreamEvent } from "../src/core/contract.js";

const COOKIE_SECRET = "test-secret-of-sufficient-length-1234";

function makeRunner(over: Partial<CodexRunner> = {}): CodexRunner {
  return {
    async startDeviceLogin() {
      return { loginUrl: "https://auth.openai.com/codex/device", userCode: "AAAA-BBBB", expiresAt: 1 };
    },
    async getStatus() {
      return { ok: true, account: "user@example.com" };
    },
    async *run(): AsyncIterable<RunStreamEvent> {
      yield { type: "assistant-text", mode: "replace", text: "hi" };
      yield { type: "done", result: { text: "hi" } };
    },
    async logout() {},
    ...over,
  };
}

const opts = (over = {}) => ({
  runner: makeRunner(),
  cookieSecret: COOKIE_SECRET,
  sessionStore: createMemorySessionStore(),
  cookieOptions: { secure: false },
  ...over,
});

const req = (method: string, path: string, init: RequestInit = {}) =>
  new Request(`http://localhost${path}`, {
    method,
    headers: { "sec-fetch-site": "same-origin", ...(init.headers as object) },
    ...init,
  });

function cookieFrom(res: Response): string {
  const sc = res.headers.get("set-cookie") ?? "";
  return sc.split(";")[0] ?? "";
}

describe("handleCodexRequest (framework-neutral)", () => {
  it("POST /session sets a cookie and returns ok", async () => {
    const o = opts();
    const res = await handleCodexRequest(req("POST", "/api/codex/session"), o);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("set-cookie")).toMatch(/codex_sid=/);
  });

  it("rejects a cross-site POST (CSRF)", async () => {
    const res = await handleCodexRequest(
      req("POST", "/api/codex/session", { headers: { "sec-fetch-site": "cross-site" } }),
      opts(),
    );
    expect(res.status).toBe(403);
  });

  it("OPTIONS preflight returns 204", async () => {
    const res = await handleCodexRequest(req("OPTIONS", "/api/codex/session"), opts());
    expect(res.status).toBe(204);
  });

  it("/run/stream rejects an UNauthenticated session with 401", async () => {
    const o = opts({ runner: makeRunner({ async getStatus() { return { ok: false }; } }) });
    const session = await handleCodexRequest(req("POST", "/api/codex/session"), o);
    const cookie = cookieFrom(session);
    const res = await handleCodexRequest(
      req("POST", "/api/codex/run/stream", {
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ prompt: "hi" }),
      }),
      o,
    );
    expect(res.status).toBe(401);
  });

  it("/run/stream streams NDJSON for an authenticated session", async () => {
    const o = opts();
    const session = await handleCodexRequest(req("POST", "/api/codex/session"), o);
    // authenticate via /status — this ROTATES the cookie (fixation defense), so
    // use the rotated cookie for the subsequent run.
    const status = await handleCodexRequest(
      req("GET", "/api/codex/status", { headers: { cookie: cookieFrom(session) } }),
      o,
    );
    const cookie = cookieFrom(status) || cookieFrom(session);
    const res = await handleCodexRequest(
      req("POST", "/api/codex/run/stream", {
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ prompt: "hi" }),
      }),
      o,
    );
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const text = await res.text();
    const lines = text.trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.some((l) => l.type === "assistant-text")).toBe(true);
  });

  it("GET /status rotates the cookie on first authentication (fixation defense)", async () => {
    const o = opts();
    const session = await handleCodexRequest(req("POST", "/api/codex/session"), o);
    const cookie = cookieFrom(session);
    const status = await handleCodexRequest(req("GET", "/api/codex/status", { headers: { cookie } }), o);
    expect(status.headers.get("set-cookie")).toMatch(/codex_sid=/); // rotated
    expect(await status.json()).toEqual({ ok: true, account: "user@example.com" });
  });

  it("GET /status without a session is 401 logged_out", async () => {
    const res = await handleCodexRequest(req("GET", "/api/codex/status"), opts());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, status: "logged_out" });
  });

  it("logout clears the cookie honoring cookieAttrs (Max-Age=0, no Secure in dev)", async () => {
    const o = opts();
    const session = await handleCodexRequest(req("POST", "/api/codex/session"), o);
    const cookie = cookieFrom(session);
    const res = await handleCodexRequest(req("POST", "/api/codex/logout", { headers: { cookie } }), o);
    const sc = res.headers.get("set-cookie") ?? "";
    expect(sc).toMatch(/Max-Age=0/);
    expect(sc).not.toMatch(/Secure/); // cookieOptions.secure=false honored
  });

  it("rejects a short cookieSecret", async () => {
    await expect(
      handleCodexRequest(req("POST", "/api/codex/session"), { runner: makeRunner(), cookieSecret: "short" }),
    ).rejects.toThrow();
  });
});
