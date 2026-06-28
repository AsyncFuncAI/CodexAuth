import { describe, it, expect } from "vitest";
import { createPersistence } from "../src/core/persistence.js";
import type { StorageLike } from "../src/core/contract.js";

function memStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe("createPersistence", () => {
  it("saves and loads a fresh session within the window", () => {
    const storage = memStorage();
    let t = 1000;
    const p = createPersistence({ storage, now: () => t, resumeMaxAgeMs: 10_000 });
    p.save();
    t = 5000; // within window
    const loaded = p.load();
    expect(loaded?.loggedIn).toBe(true);
  });

  it("clears and returns null for a stale session", () => {
    const storage = memStorage();
    let t = 1000;
    const p = createPersistence({ storage, now: () => t, resumeMaxAgeMs: 1000 });
    p.save();
    t = 100_000; // way past window
    expect(p.load()).toBeNull();
    expect(storage.map.size).toBe(0);
  });

  it("does not persist account by default (no PII in storage)", () => {
    const storage = memStorage();
    const p = createPersistence({ storage });
    p.save("user@example.com");
    const raw = storage.getItem("codex-auth:session")!;
    expect(raw).not.toContain("user@example.com");
  });

  it("persists account when opted in", () => {
    const storage = memStorage();
    const p = createPersistence({ storage, persistAccount: true });
    p.save("user@example.com");
    expect(p.load()?.account).toBe("user@example.com");
  });

  it("is SSR-safe with storage:null (no throw, no resume)", () => {
    const p = createPersistence({ storage: null });
    expect(() => p.save("x")).not.toThrow();
    expect(p.load()).toBeNull();
  });

  it("clears corrupt JSON", () => {
    const storage = memStorage();
    storage.setItem("codex-auth:session", "{ not json");
    const p = createPersistence({ storage });
    expect(p.load()).toBeNull();
    expect(storage.map.size).toBe(0);
  });
});
