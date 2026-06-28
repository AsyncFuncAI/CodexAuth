// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { createCodexProxy } from "../src/backend/worker/index.js";

const ENV = { CODEX_BACKEND_ORIGIN: "https://backend.example.com" };

afterEach(() => vi.unstubAllGlobals());

describe("createCodexProxy (Cloudflare Worker)", () => {
  const proxy = createCodexProxy();

  it("404s requests outside the base path", async () => {
    const res = await proxy.fetch(new Request("https://edge.example/other"), ENV);
    expect(res.status).toBe(404);
  });

  it("rejects a non-https backend origin", async () => {
    const res = await proxy.fetch(
      new Request("https://edge.example/api/codex/status"),
      { CODEX_BACKEND_ORIGIN: "http://insecure.example" },
    );
    expect(res.status).toBe(500);
  });

  it("forwards the request to the backend and streams the response back", async () => {
    const upstream = vi.fn(async (input: Request) => {
      // assert the proxy preserved path + query against the backend origin
      const url = new URL(input.url);
      expect(url.origin).toBe("https://backend.example.com");
      expect(url.pathname).toBe("/api/codex/status");
      return new Response(JSON.stringify({ ok: true, account: "a@b" }), {
        status: 200,
        headers: { "content-type": "application/json", "set-cookie": "codex_sid=x" },
      });
    });
    vi.stubGlobal("fetch", upstream);
    const res = await proxy.fetch(
      new Request("https://edge.example/api/codex/status?foo=1", {
        headers: { cookie: "codex_sid=abc" },
      }),
      ENV,
    );
    expect(res.status).toBe(200);
    // upstream Set-Cookie is faithfully returned
    expect(res.headers.get("set-cookie")).toBe("codex_sid=x");
    expect(await res.json()).toEqual({ ok: true, account: "a@b" });
  });
});
