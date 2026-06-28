import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { classifyStatus, createPoller } from "../src/core/poll.js";

describe("classifyStatus", () => {
  it("401 → logged_out", () => {
    expect(classifyStatus(401, null).kind).toBe("logged_out");
  });
  it("200 {ok:true} → authenticated", () => {
    expect(classifyStatus(200, { ok: true, account: "a@b" })).toEqual({
      kind: "authenticated",
      account: "a@b",
    });
  });
  it("200 {ok:false} (pending) → pending, NOT logged_out", () => {
    expect(classifyStatus(200, { ok: false }).kind).toBe("pending");
  });
  it("200 {ok:false,status:'logged_out'} → logged_out", () => {
    expect(classifyStatus(200, { ok: false, status: "logged_out" }).kind).toBe("logged_out");
  });
  it("5xx → transient", () => {
    expect(classifyStatus(503, null).kind).toBe("transient");
  });
});

describe("createPoller", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function harness(probe: any, extra: any = {}) {
    const onAuthenticated = vi.fn();
    const onLoggedOut = vi.fn();
    const onExpired = vi.fn();
    const onFailed = vi.fn();
    const p = createPoller({
      probe,
      intervalMs: 3000,
      onAuthenticated,
      onLoggedOut,
      onExpired,
      onFailed,
      ...extra,
    });
    return { p, onAuthenticated, onLoggedOut, onExpired, onFailed };
  }

  it("polls until authenticated then stops", async () => {
    let n = 0;
    const probe = vi.fn(async () =>
      ++n < 2 ? ({ kind: "pending" } as const) : ({ kind: "authenticated", account: "z" } as const),
    );
    const { p, onAuthenticated } = harness(probe);
    p.start();
    await vi.advanceTimersByTimeAsync(0); // first immediate probe
    await vi.advanceTimersByTimeAsync(3000); // second probe
    expect(onAuthenticated).toHaveBeenCalledWith("z");
    expect(p.isRunning()).toBe(false);
  });

  it("signs out on a logged_out outcome", async () => {
    const { p, onLoggedOut } = harness(async () => ({ kind: "logged_out" }) as const);
    p.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(onLoggedOut).toHaveBeenCalled();
  });

  it("does NOT sign out on pending", async () => {
    const { p, onLoggedOut } = harness(async () => ({ kind: "pending" }) as const);
    p.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(3000);
    expect(onLoggedOut).not.toHaveBeenCalled();
    p.stop();
  });

  it("stops with onExpired past the deadline", async () => {
    let t = 1000;
    const { p, onExpired } = harness(async () => ({ kind: "pending" }) as const, {
      now: () => t,
      getExpiresAt: () => 2000,
    });
    p.start();
    await vi.advanceTimersByTimeAsync(0); // pending
    t = 3000; // now past expiry
    await vi.advanceTimersByTimeAsync(3000);
    expect(onExpired).toHaveBeenCalled();
    expect(p.isRunning()).toBe(false);
  });

  it("fails after N consecutive transient errors", async () => {
    const { p, onFailed } = harness(async () => ({ kind: "transient" }) as const, {
      maxConsecutiveFailures: 3,
    });
    p.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(onFailed).toHaveBeenCalled();
  });

  it("start() is idempotent", () => {
    const probe = vi.fn(async () => ({ kind: "pending" }) as const);
    const { p } = harness(probe);
    p.start();
    p.start();
    expect(p.isRunning()).toBe(true);
    p.stop();
  });
});
