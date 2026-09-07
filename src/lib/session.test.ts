import { afterEach, describe, expect, test, vi } from "vitest";
import { clearSessionKeys, readSessionKey, storeSessionKey } from "./session";
import { EMPTY_DRAFT, resetDraftForTests, restoredDraft, writeDraft } from "./funnel";
import { clearLocalState } from "./signout";

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

/**
 * A browser with site data blocked: `localStorage` exists and throws.
 *
 * `length` throws too, which is the shape `clearSessionKeys` has to survive:
 * it enumerates the store, and enumeration starts by asking how big it is.
 */
function blockedStore() {
  const boom = () => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  return {
    getItem: vi.fn(boom),
    setItem: vi.fn(boom),
    removeItem: vi.fn(boom),
    key: vi.fn(boom),
    get length(): number {
      return boom();
    },
  };
}

/**
 * A browser that keeps things.
 *
 * `key(i)` and `length` are real rather than stubs, because `clearSessionKeys`
 * walks the store by index and removing an entry reindexes what is left -- a
 * detail a Map-shaped fake would hide and a real browser would not.
 */
function workingStore(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: vi.fn((k: string) => map.get(k) ?? null),
    setItem: vi.fn((k: string, value: string) => {
      map.set(k, value);
    }),
    removeItem: vi.fn((k: string) => {
      map.delete(k);
    }),
    key: vi.fn((i: number) => Array.from(map.keys())[i] ?? null),
    get length() {
      return map.size;
    },
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

/**
 * Signing out has to clear BOTH stores.
 *
 * The auth session and the room capabilities are independent: signing out of
 * Better Auth leaves every `questly-session-` key exactly where it was, and on
 * a shared laptop the next person to open `/room/<code>` is let straight into
 * a room they were never in. Handing seats over is what this exists to stop.
 */
describe("signing out", () => {
  test("every room key this browser holds is dropped, in both stores", () => {
    const store = workingStore({ "questly-session-2001": "key-from-before" });
    vi.stubGlobal("localStorage", store);
    storeSessionKey("2002", "key-bec");

    clearSessionKeys();

    // Persisted and in-memory alike: `readSessionKey` consults memory first,
    // so clearing only the store would answer from the Map for the rest of
    // the page's life.
    expect(store.map.size).toBe(0);
    expect(readSessionKey("2001")).toBeNull();
    expect(readSessionKey("2002")).toBeNull();
  });

  test("nothing else in the store is touched", () => {
    const store = workingStore({
      "questly-session-2003": "ours",
      "questly-theme": "day",
      "something-else": "not ours",
    });
    vi.stubGlobal("localStorage", store);

    clearSessionKeys();

    // Every key is walked and only the prefixed ones go -- the theme
    // preference is in the same store and has nothing to do with a sign-out.
    expect(Array.from(store.map.keys()).sort()).toEqual(["questly-theme", "something-else"]);
  });

  test("a store that throws does not take the sign-out down with it", () => {
    vi.stubGlobal("localStorage", blockedStore());
    storeSessionKey("2004", "key-tam");

    // A browser refusing site data has nothing persisted to clear, but it does
    // have the in-memory fallback -- which is exactly the store holding the key
    // in that browser, so it must still be emptied.
    expect(() => clearSessionKeys()).not.toThrow();
    expect(readSessionKey("2004")).toBeNull();
  });

  test("a browser with no localStorage at all clears what it does have", () => {
    vi.stubGlobal("localStorage", undefined);
    storeSessionKey("2005", "key-sam");

    expect(() => clearSessionKeys()).not.toThrow();
    expect(readSessionKey("2005")).toBeNull();
  });
});

/**
 * The draft is the OTHER thing a sign-out has to drop, and forgetting it was a
 * real cross-account leak rather than a tidiness point.
 */
describe("clearing everything this browser holds for one person", () => {
  test("the funnel draft goes along with the room keys", () => {
    vi.stubGlobal("localStorage", workingStore());
    vi.stubGlobal("sessionStorage", workingStore());
    resetDraftForTests();
    storeSessionKey("2006", "key-bec");
    writeDraft({ ...EMPTY_DRAFT, step: "quiz", answers: { walk: "more" } });
    expect(restoredDraft()).not.toBeNull();

    clearLocalState();

    // Left behind, the draft is not inert: /start restores it for whoever is
    // signed in NEXT, and finishing the funnel submits it through `saveQuiz`,
    // which derives the user id from the CURRENT identity. One person's taste
    // answers landed on the next person's account.
    expect(restoredDraft()).toBeNull();
    expect(readSessionKey("2006")).toBeNull();
  });
});
