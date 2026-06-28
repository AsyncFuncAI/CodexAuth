import { describe, it, expect } from "vitest";
import { assertSafeLoginUrl, closePopup, isClosed } from "../src/core/popup.js";

describe("assertSafeLoginUrl", () => {
  it("accepts an https auth.openai.com URL", () => {
    expect(() =>
      assertSafeLoginUrl("https://auth.openai.com/oauth/authorize?x=1"),
    ).not.toThrow();
  });

  it("rejects javascript: URLs", () => {
    expect(() => assertSafeLoginUrl("javascript:alert(1)")).toThrow();
  });

  it("rejects http: (non-TLS) URLs", () => {
    expect(() => assertSafeLoginUrl("http://auth.openai.com/x")).toThrow();
  });

  it("rejects hosts outside the allowlist", () => {
    expect(() => assertSafeLoginUrl("https://evil.example.com/x")).toThrow();
  });

  it("honors a custom allowlist", () => {
    expect(() =>
      assertSafeLoginUrl("https://login.acme.dev/x", ["login.acme.dev"]),
    ).not.toThrow();
  });

  it("rejects malformed URLs", () => {
    expect(() => assertSafeLoginUrl("not a url")).toThrow();
  });
});

describe("popup null-safety", () => {
  it("closePopup(null) does not throw", () => {
    expect(() => closePopup(null)).not.toThrow();
  });
  it("isClosed(null) is false", () => {
    expect(isClosed(null)).toBe(false);
  });
});
