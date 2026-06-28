// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { directRunner } from "../src/backend/direct/directRunner.js";
import { accountIdFrom } from "../src/backend/direct/oauth.js";
import type { SessionCtx } from "../src/backend/types.js";
import type { RunStreamEvent } from "../src/core/contract.js";

// Build a fake access token JWT whose claim carries the chatgpt_account_id.
function fakeAccessToken(accountId: string, email = "me@example.com"): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ email, "https://api.openai.com/auth": { chatgpt_account_id: accountId } }),
  ).toString("base64url");
  return `${header}.${payload}.sig`;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const sse = (lines: string[]) =>
  new Response(lines.join("\n\n") + "\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });

describe("accountIdFrom (JWT claim)", () => {
  it("extracts chatgpt_account_id from the access token", () => {
    expect(accountIdFrom(fakeAccessToken("acct-123"))).toBe("acct-123");
  });
  it("returns null when the claim is absent", () => {
    const t = Buffer.from(JSON.stringify({ sub: "x" })).toString("base64url");
    expect(accountIdFrom(`h.${t}.s`)).toBeNull();
  });
});

describe("directRunner — device flow over mocked fetch", () => {
  function mockFetch(map: Record<string, () => Response>) {
    return vi.fn(async (url: string | URL | Request) => {
      const u = typeof url === "string" ? url : url.toString();
      const key = Object.keys(map).find((k) => u.includes(k));
      if (!key) throw new Error(`unexpected fetch ${u}`);
      return map[key]!();
    });
  }

  const token = fakeAccessToken("acct-9");
  const tokenBody = { access_token: token, refresh_token: "r1", expires_in: 3600 };

  it("startDeviceLogin returns a login URL + user code", async () => {
    const f = mockFetch({
      "deviceauth/usercode": () => json(200, { device_auth_id: "dev1", user_code: "ABCD-EFGH", interval: 5 }),
    });
    const r = directRunner({ fetch: f as unknown as typeof fetch });
    const ctx: SessionCtx = { id: "s1", data: {} };
    const res = await r.startDeviceLogin(ctx);
    expect(res).toMatchObject({ loginUrl: expect.stringContaining("auth.openai.com"), userCode: "ABCD-EFGH" });
  });

  it("getStatus polls and completes the login, returning the account", async () => {
    let polled = 0;
    const f = mockFetch({
      "deviceauth/usercode": () => json(200, { device_auth_id: "dev1", user_code: "ABCD-EFGH", interval: 5 }),
      "deviceauth/token": () => {
        polled += 1;
        return polled < 2
          ? json(403, { error: { code: "deviceauth_authorization_pending" } })
          : json(200, { authorization_code: "auth-code", code_verifier: "verifier" });
      },
      "oauth/token": () => json(200, tokenBody),
    });
    const r = directRunner({ fetch: f as unknown as typeof fetch });
    const ctx: SessionCtx = { id: "s2", data: {} };
    await r.startDeviceLogin(ctx);
    const pending = await r.getStatus(ctx);
    expect(pending).toEqual({ ok: false, status: "pending" });
    const done = await r.getStatus(ctx);
    expect(done).toEqual({ ok: true, account: "me@example.com" });
  });

  it("run streams assistant-text deltas then done", async () => {
    const f = mockFetch({
      "deviceauth/usercode": () => json(200, { device_auth_id: "d", user_code: "AAAA-BBBB", interval: 5 }),
      "deviceauth/token": () => json(200, { authorization_code: "c", code_verifier: "v" }),
      "oauth/token": () => json(200, tokenBody),
      "codex/models": () => json(200, { models: [{ slug: "gpt-5-codex" }] }),
      "codex/responses": () =>
        sse([
          'data: {"type":"response.output_text.delta","delta":"Salt "}',
          'data: {"type":"response.output_text.delta","delta":"wind"}',
          "data: [DONE]",
        ]),
    });
    const r = directRunner({ fetch: f as unknown as typeof fetch });
    const ctx: SessionCtx = { id: "s3", data: {} };
    await r.startDeviceLogin(ctx);
    await r.getStatus(ctx); // completes login

    const events: RunStreamEvent[] = [];
    for await (const e of r.run(ctx, "haiku")) events.push(e);
    const texts = events.filter((e) => e.type === "assistant-text").map((e) => (e as any).text);
    expect(texts.join("")).toBe("Salt wind");
    expect(events.at(-1)).toEqual({ type: "done", result: { text: "Salt wind" } });
  });

  it("run on an unauthenticated session yields an error event", async () => {
    const f = vi.fn();
    const r = directRunner({ fetch: f as unknown as typeof fetch });
    const ctx: SessionCtx = { id: "s4", data: {} };
    const events: RunStreamEvent[] = [];
    for await (const e of r.run(ctx, "x")) events.push(e);
    expect(events[0]).toEqual({ type: "error", error: "not authenticated" });
  });

  it("logout clears the session credentials", async () => {
    const f = mockFetch({
      "deviceauth/usercode": () => json(200, { device_auth_id: "d", user_code: "AAAA-BBBB", interval: 5 }),
      "deviceauth/token": () => json(200, { authorization_code: "c", code_verifier: "v" }),
      "oauth/token": () => json(200, tokenBody),
    });
    const r = directRunner({ fetch: f as unknown as typeof fetch });
    const ctx: SessionCtx = { id: "s5", data: {} };
    await r.startDeviceLogin(ctx);
    await r.getStatus(ctx);
    await r.logout(ctx);
    // a fresh getStatus with no device flow is pending (logged out)
    expect(await r.getStatus(ctx)).toEqual({ ok: false, status: "pending" });
  });
});

describe("directRunner — token confinement", () => {
  it("never returns access/refresh tokens from any method", async () => {
    const token = fakeAccessToken("acct-x");
    const f = vi.fn(async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.includes("usercode")) return json(200, { device_auth_id: "d", user_code: "AAAA-BBBB", interval: 5 });
      if (u.includes("deviceauth/token")) return json(200, { authorization_code: "c", code_verifier: "v" });
      if (u.includes("oauth/token")) return json(200, { access_token: token, refresh_token: "SECRET", expires_in: 3600 });
      throw new Error("unexpected");
    });
    const r = directRunner({ fetch: f as unknown as typeof fetch });
    const ctx: SessionCtx = { id: "s6", data: {} };
    const start = JSON.stringify(await r.startDeviceLogin(ctx));
    const status = JSON.stringify(await r.getStatus(ctx));
    expect(start).not.toContain("SECRET");
    expect(status).not.toContain("SECRET");
    expect(status).not.toContain(token);
  });
});
