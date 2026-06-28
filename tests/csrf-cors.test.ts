// @vitest-environment node
import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { createCodexRouter } from "../src/backend/express/createCodexRouter.js";
import type { CodexRunner } from "../src/backend/types.js";

const COOKIE_SECRET = "test-secret-of-sufficient-length-1234";

const runner: CodexRunner = {
  async startDeviceLogin() { return { loggedIn: true }; },
  async getStatus() { return { ok: true, account: "a@b.com" }; },
  async *run() {},
  async logout() {},
};

function app(allowedOrigins?: string[]) {
  const a = express();
  a.use("/api/codex", createCodexRouter({ runner, cookieSecret: COOKIE_SECRET, allowedOrigins }));
  return a;
}

describe("CSRF enforcement", () => {
  it("rejects a cross-site POST (Sec-Fetch-Site: cross-site)", async () => {
    const res = await request(app())
      .post("/api/codex/session")
      .set("Sec-Fetch-Site", "cross-site");
    expect(res.status).toBe(403);
  });

  it("rejects a POST whose Origin host differs from the Host header", async () => {
    const res = await request(app())
      .post("/api/codex/login/start")
      .set("Origin", "https://evil.example.com");
    expect(res.status).toBe(403);
  });

  it("allows a same-origin POST", async () => {
    const res = await request(app())
      .post("/api/codex/session")
      .set("Sec-Fetch-Site", "same-origin");
    expect(res.status).toBe(200);
  });
});

describe("CORS for cross-origin backends", () => {
  it("emits the specific allowed origin (never *) with credentials", async () => {
    const res = await request(app(["https://app.example.com"]))
      .options("/api/codex/session")
      .set("Origin", "https://app.example.com");
    expect(res.headers["access-control-allow-origin"]).toBe("https://app.example.com");
    expect(res.headers["access-control-allow-origin"]).not.toBe("*");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("does not emit CORS headers for an unlisted origin", async () => {
    const res = await request(app(["https://app.example.com"]))
      .options("/api/codex/session")
      .set("Origin", "https://evil.example.com");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
