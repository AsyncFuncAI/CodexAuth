import { describe, it, expect } from "vitest";
import {
  transition,
  initialSnapshot,
  type CodexAuthEvent,
} from "../src/core/stateMachine.js";

const run = (events: CodexAuthEvent[]) =>
  events.reduce((s, e) => transition(s, e), initialSnapshot);

describe("auth state machine", () => {
  it("happy path: idle → connecting → waitingForLogin → authenticated", () => {
    const s1 = transition(initialSnapshot, { type: "LOGIN_CLICK" });
    expect(s1.status).toBe("connecting");
    const s2 = transition(s1, {
      type: "LOGIN_PENDING",
      pending: { loginUrl: "https://auth.openai.com/x", userCode: "BNPY-MZ5DA", expiresAt: 123 },
    });
    expect(s2.status).toBe("waitingForLogin");
    expect(s2.userCode).toBe("BNPY-MZ5DA");
    expect(s2.expiresAt).toBe(123);
    const s3 = transition(s2, { type: "AUTHENTICATED", account: "a@b.com" });
    expect(s3.status).toBe("authenticated");
    expect(s3.account).toBe("a@b.com");
    expect(s3.userCode).toBeNull();
  });

  it("connecting + ALREADY_LOGGED_IN → authenticated (skips waiting)", () => {
    const s = run([{ type: "LOGIN_CLICK" }, { type: "ALREADY_LOGGED_IN", account: "z@z.com" }]);
    expect(s.status).toBe("authenticated");
    expect(s.account).toBe("z@z.com");
  });

  it("DEVICE_AUTH_NOT_ENABLED → error with that code", () => {
    const s = run([{ type: "LOGIN_CLICK" }, { type: "DEVICE_AUTH_NOT_ENABLED" }]);
    expect(s.status).toBe("error");
    expect(s.error?.code).toBe("DEVICE_AUTH_NOT_ENABLED");
  });

  it("POPUP_BLOCKED sets the flag + error, stays connecting until pending", () => {
    const s = run([{ type: "LOGIN_CLICK" }, { type: "POPUP_BLOCKED" }]);
    expect(s.popupBlocked).toBe(true);
    expect(s.error?.code).toBe("POPUP_BLOCKED");
    expect(s.status).toBe("connecting");
    // pending arriving later keeps the popupBlocked error so the fallback shows
    const s2 = transition(s, {
      type: "LOGIN_PENDING",
      pending: { loginUrl: "https://auth.openai.com/x", userCode: "AAAA", expiresAt: 1 },
    });
    expect(s2.status).toBe("waitingForLogin");
    expect(s2.error?.code).toBe("POPUP_BLOCKED");
  });

  it("waitingForLogin + EXPIRED → error EXPIRED", () => {
    const s = run([
      { type: "LOGIN_CLICK" },
      { type: "LOGIN_PENDING", pending: { loginUrl: "https://auth.openai.com/x", userCode: "A", expiresAt: 1 } },
      { type: "EXPIRED" },
    ]);
    expect(s.status).toBe("error");
    expect(s.error?.code).toBe("EXPIRED");
  });

  it("CANCEL and LOGGED_OUT both go to loggedOut", () => {
    expect(transition(initialSnapshot, { type: "CANCEL" }).status).toBe("loggedOut");
    expect(transition(initialSnapshot, { type: "LOGGED_OUT" }).status).toBe("loggedOut");
  });

  it("RESUME_START → resuming, RESUME_STALE → idle", () => {
    const r = transition(initialSnapshot, { type: "RESUME_START" });
    expect(r.status).toBe("resuming");
    expect(transition(r, { type: "RESUME_STALE" }).status).toBe("idle");
  });

  it("is referentially transparent (no mutation of input)", () => {
    const input = { ...initialSnapshot };
    transition(input, { type: "LOGIN_CLICK" });
    expect(input).toEqual(initialSnapshot);
  });

  it("unknown event leaves state unchanged", () => {
    const s = transition(initialSnapshot, { type: "NOPE" } as unknown as CodexAuthEvent);
    expect(s).toBe(initialSnapshot);
  });
});
