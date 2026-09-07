import { afterEach, describe, expect, test, vi } from "vitest";
import { readSessionKey, storeSessionKey } from "./session";

/**
 * These test the two storage functions directly, not the hook: vitest here runs
 * one global `edge-runtime` environment with no DOM, so there is nothing to
 * render React into. That is the right seam anyway -- both /join and /room go
 * through this pair and nothing else, so the round trip either survives here or
 * it does not survive at all.
 *
 * Every test uses its own room code, because the in-memory fallback is a module
 * -level store that outlives one test the same way it outlives one page.
 */

/** A browser with site data blocked: `localStorage` exists and throws. */
function blockedStore() {
  return {
    getItem: vi.fn(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    }),
    setItem: vi.fn(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    }),
  };
}

/** A browser that keeps things. */
function workingStore(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: vi.fn((k: string) => map.get(k) ?? null),
    setItem: vi.fn((k: string, value: string) => {
      map.set(k, value);
    }),
    map,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a browser that refuses localStorage", () => {
  test("a key that cannot be persisted is still readable for this session", () => {
    const store = blockedStore();
    vi.stubGlobal("localStorage", store);

    // This is /join, being let in.
    storeSessionKey("1001", "key-tam");
    expect(store.setItem).toHaveBeenCalled();

    // And this is /room, on the next page load of the same tab. Before the
    // fallback this returned null, the room bounced back to /join, and every
    // retry inserted another member row that nobody held a key for -- a
    // denominator the room could never reach unanimity against.
    expect(readSessionKey("1001")).toBe("key-tam");
  });

  test("reading a room nothing was stored for is still null, not a throw", () => {
    vi.stubGlobal("localStorage", blockedStore());
    expect(readSessionKey("1002")).toBeNull();
  });

  test("one room's key is never handed back for another room", () => {
    vi.stubGlobal("localStorage", blockedStore());
    storeSessionKey("1003", "key-for-1003");

    // The hook's `ready` gate distinguishes "no key" from "have not looked";
    // this is the other half of that contract -- a wrong-room key is worse
    // than none, because the room would accept it and show someone else's.
    expect(readSessionKey("1004")).toBeNull();
    expect(readSessionKey("1003")).toBe("key-for-1003");
  });
});

describe("a browser with no localStorage at all", () => {
  test("storing does not throw, and the key survives the navigation", () => {
    // No store object at all -- an embedded webview, or this file's own
    // runtime. The call throws on the property access rather than returning
    // null, which is why both functions wrap the whole access, not just a
    // hypothetical failure inside it.
    vi.stubGlobal("localStorage", undefined);
    expect(() => storeSessionKey("1005", "key-sam")).not.toThrow();
    expect(readSessionKey("1005")).toBe("key-sam");
    expect(readSessionKey("1006")).toBeNull();
  });
});

describe("a browser that keeps things", () => {
  test("the key is written through to the store, and read back from it", () => {
    const store = workingStore();
    vi.stubGlobal("localStorage", store);

    storeSessionKey("1007", "key-bec");
    expect(store.map.get("questly-session-1007")).toBe("key-bec");
    expect(readSessionKey("1007")).toBe("key-bec");
  });

  test("a key persisted by an earlier page load is found with nothing in memory", () => {
    // The whole point of persisting: a reload has an empty Map.
    vi.stubGlobal("localStorage", workingStore({ "questly-session-1008": "key-from-before" }));
    expect(readSessionKey("1008")).toBe("key-from-before");
  });

  test("a key stored this session wins over a stale persisted one", () => {
    const store = workingStore({ "questly-session-1009": "stale" });
    // A write that fails the quota wall would leave the old value answering
    // for a fresh membership, so memory is the newer of the two by definition.
    store.setItem.mockImplementation(() => {
      throw new DOMException("QuotaExceededError", "QuotaExceededError");
    });
    vi.stubGlobal("localStorage", store);

    storeSessionKey("1009", "fresh");
    expect(readSessionKey("1009")).toBe("fresh");
  });
});
