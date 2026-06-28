import { describe, it, expect } from "vitest";
import { md5 } from "../src/core/md5.js";
import { gravatarUrl } from "../src/core/gravatar.js";

describe("md5", () => {
  // RFC 1321 / well-known test vectors
  it("matches known vectors", () => {
    expect(md5("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(md5("The quick brown fox jumps over the lazy dog")).toBe(
      "9e107d9d372bb6826bd81d3542a419d6",
    );
  });
});

describe("gravatarUrl", () => {
  it("hashes the normalized email with MD5", () => {
    // gravatar's documented example hash for MyEmailAddress@example.com
    const url = gravatarUrl("MyEmailAddress@example.com  ");
    expect(url).toContain("0bc83cb571cd1c50ba6f3e8a78ef1346");
    expect(url).toContain("d=404");
  });

  it("returns null for a non-email", () => {
    expect(gravatarUrl("ChatGPT account")).toBeNull();
    expect(gravatarUrl("")).toBeNull();
  });
});
