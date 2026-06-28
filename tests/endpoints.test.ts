import { describe, it, expect } from "vitest";
import { resolveEndpoints, DEFAULT_BASE_PATH } from "../src/core/endpoints.js";

describe("resolveEndpoints", () => {
  it("derives all five routes from the default basePath", () => {
    const e = resolveEndpoints();
    expect(e).toEqual({
      session: "/api/codex/session",
      loginStart: "/api/codex/login/start",
      status: "/api/codex/status",
      runStream: "/api/codex/run/stream",
      logout: "/api/codex/logout",
    });
    expect(DEFAULT_BASE_PATH).toBe("/api/codex");
  });

  it("reflects a custom basePath in all five routes", () => {
    const e = resolveEndpoints({ basePath: "/codex" });
    expect(e.session).toBe("/codex/session");
    expect(e.runStream).toBe("/codex/run/stream");
  });

  it("strips a trailing slash from basePath", () => {
    const e = resolveEndpoints({ basePath: "/api/codex/" });
    expect(e.status).toBe("/api/codex/status");
  });

  it("replaces only the overridden route, verbatim, with an absolute URL", () => {
    const e = resolveEndpoints({
      endpoints: { status: "https://api.example.com/codex/status" },
    });
    expect(e.status).toBe("https://api.example.com/codex/status");
    // others stay basePath-derived
    expect(e.session).toBe("/api/codex/session");
  });

  it("uses a relative override verbatim", () => {
    const e = resolveEndpoints({ endpoints: { logout: "/custom/logout" } });
    expect(e.logout).toBe("/custom/logout");
  });
});
