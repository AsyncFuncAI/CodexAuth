// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createCodexClient } from "../src/core/createCodexClient.js";

function mockFetch(routes: Record<string, () => Response>) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === "string" ? url : url.toString();
    const key = `${init?.method ?? "GET"} ${u}`;
    const handler = routes[key] ?? routes[u];
    if (!handler) throw new Error(`unexpected fetch: ${key}`);
    return handler();
  });
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("createCodexClient", () => {
  it("ensureSession always POSTs /session", async () => {
    const f = mockFetch({ "POST /api/codex/session": () => json(200, { ok: true }) });
    const c = createCodexClient({ fetch: f as unknown as typeof fetch });
    await c.ensureSession();
    expect(f).toHaveBeenCalledWith(
      "/api/codex/session",
      expect.objectContaining({ method: "POST" }),
    );
    c.destroy();
  });

  it("startLogin with {loggedIn:true} → authenticated", async () => {
    const f = mockFetch({
      "POST /api/codex/login/start": () => json(200, { ok: true, loggedIn: true }),
      "GET /api/codex/status": () => json(200, { ok: true, account: "me@x.com" }),
    });
    const c = createCodexClient({ fetch: f as unknown as typeof fetch });
    await c.startLogin();
    expect(c.getState().status).toBe("authenticated");
    expect(c.getState().account).toBe("me@x.com");
    c.destroy();
  });

  it("startLogin with DEVICE_AUTH_NOT_ENABLED → error code", async () => {
    const f = mockFetch({
      "POST /api/codex/login/start": () => json(200, { errorCode: "DEVICE_AUTH_NOT_ENABLED" }),
    });
    const c = createCodexClient({ fetch: f as unknown as typeof fetch });
    await c.startLogin();
    expect(c.getState().status).toBe("error");
    expect(c.getState().error?.code).toBe("DEVICE_AUTH_NOT_ENABLED");
    c.destroy();
  });

  it("startLogin with pending → waitingForLogin + userCode", async () => {
    const f = mockFetch({
      "POST /api/codex/login/start": () =>
        json(200, {
          loginUrl: "https://auth.openai.com/x",
          userCode: "BNPY-MZ5DA",
          expiresAt: Date.now() + 60_000,
        }),
      "GET /api/codex/status": () => json(200, { ok: false }),
    });
    const c = createCodexClient({ fetch: f as unknown as typeof fetch });
    await c.startLogin();
    expect(c.getState().status).toBe("waitingForLogin");
    expect(c.getState().userCode).toBe("BNPY-MZ5DA");
    c.destroy();
  });

  it("logout clears state even when the request rejects", async () => {
    const f = vi.fn(async (url: string) => {
      if (url.endsWith("/logout")) throw new Error("network down");
      return json(200, { ok: true });
    });
    const c = createCodexClient({ fetch: f as unknown as typeof fetch });
    await c.logout();
    expect(c.getState().status).toBe("loggedOut");
    c.destroy();
  });

  it("subscribe notifies on state change and unsubscribe stops it", async () => {
    const f = mockFetch({
      "POST /api/codex/login/start": () =>
        json(200, { loginUrl: "https://auth.openai.com/x", userCode: "A", expiresAt: Date.now() + 9999 }),
      "GET /api/codex/status": () => json(200, { ok: false }),
    });
    const c = createCodexClient({ fetch: f as unknown as typeof fetch });
    const seen: string[] = [];
    const unsub = c.subscribe((s) => seen.push(s.status));
    await c.startLogin();
    expect(seen).toContain("waitingForLogin");
    unsub();
    c.destroy();
  });
});
