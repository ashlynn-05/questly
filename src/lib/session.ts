"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * A guest's proof that they belong to a room. Stored per-room so one device can
 * hold two rooms at once -- which is exactly what happens when the app is
 * demoed on a laptop and a phone side by side.
 */
const PREFIX = "questly-session-";

const keyFor = (code: string) => `${PREFIX}${code}`;

/**
 * The same keys, in memory, for the browsers that refuse to keep them.
 *
 * `localStorage` THROWS in Safari's "Block All Cookies", in some embedded
 * webviews and in a few private-browsing modes -- and /join and /room are two
 * separate page loads that talk to each other through this store and nothing
 * else. Swallowing that throw silently used to mean the guest was bounced
 * straight back to /join, where `rooms.join` -- correctly unable to recognise
 * an accountless guest who arrives with no key -- inserts ANOTHER member row.
 * Every retry permanently raised the unanimity denominator, so the room could
 * never match again: the exact phantom member the join flow's other guards
 * exist to prevent.
 *
 * A module-level Map survives a client-side navigation within one tab, which
 * is what /join -> /room is, so the key is readable for this session even when
 * nothing can be persisted. It does not survive a reload, and it is not meant
 * to: it closes the round trip, it does not pretend to be storage.
 */
const inMemory = new Map<string, string>();

/**
 * Store a key for a room the caller has just been let into.
 *
 * The hook below cannot serve that case: the room code does not exist until
 * `rooms.create` resolves, and a hook cannot be called once it does. So the
 * write lives here instead of being retyped at each call site -- one key
 * format, and one try/catch for private browsing, where `localStorage` throws
 * rather than returning null.
 */
export function storeSessionKey(code: string, key: string) {
  // Memory first, and unconditionally: it is the half that cannot fail, and
  // the persisted half is the bonus.
  inMemory.set(keyFor(code), key);
  try {
    localStorage.setItem(keyFor(code), key);
  } catch {
    // Only survival is lost -- `readSessionKey` still finds it this session.
  }
}

/**
 * Read back the key this device holds for one room, or null.
 *
 * Memory wins over the store, because memory is only ever written by a
 * `storeSessionKey` in this page's lifetime and is therefore the newer of the
 * two whenever they disagree -- a write that hit the quota wall would
 * otherwise leave a stale persisted key answering for a fresh membership.
 */
export function readSessionKey(code: string): string | null {
  const remembered = inMemory.get(keyFor(code));
  if (remembered !== undefined) return remembered;
  try {
    return localStorage.getItem(keyFor(code));
  } catch {
    return null; // no store, and nothing stored this session either
  }
}

/**
 * Drop every room key this device holds. What signing out has to do beyond
 * signing out.
 *
 * A `sessionKey` is a capability, not a session cookie: the two stores are
 * independent, and clearing only the auth session would leave a shared laptop
 * holding working keys to every room the last person was in -- keys that
 * `rooms.get` accepts on their own, with no identity involved at all. So sign
 * out clears both, and this is the half the auth library cannot know about.
 *
 * Both stores, and in that order. The in-memory Map is the one that cannot
 * fail, and it is also the one `readSessionKey` consults first -- clearing
 * `localStorage` alone would leave the next read answering out of memory with a
 * key that is supposedly gone.
 *
 * The persisted half is enumerated rather than derived from the Map, because
 * the Map only knows what THIS page load wrote. A key persisted last Tuesday is
 * exactly the one that most needs to go, and the only way to find it is to walk
 * the store. Backwards, because removing an item reindexes everything after it.
 */
export function clearSessionKeys() {
  inMemory.clear();
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    // A browser that refuses site storage has nothing persisted to clear, and
    // the half that mattered -- the in-memory Map -- is already gone.
  }
}

export function useSessionKey(code: string) {
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  // `ready` separates "no key" from "have not looked yet". Without it the room
  // page redirects to /join on its first render, every time.
  const [ready, setReady] = useState(false);
  // Which room `sessionKey`/`ready` actually describe. A caller can stay
  // mounted and hand this hook a new `code` -- navigating from one room to
  // another -- and the effect below only re-runs after that render commits.
  // Without tracking this, the render in between would hand back the OLD
  // room's key/ready state under the NEW room's code: a real key, just for
  // the wrong room, for exactly one render. Resetting here, in the render
  // body, means that render never reaches the screen -- React discards it
  // and re-renders with the reset state before anything commits. This is
  // not a second effect: the effect below still owns every actual read.
  const [trackedCode, setTrackedCode] = useState(code);
  if (trackedCode !== code) {
    setTrackedCode(code);
    setSessionKey(null);
    setReady(false);
  }

  // `localStorage` does not exist while this renders on the server, so the
  // read cannot happen during render or in `useState`'s initialiser -- it has
  // to be an effect, and an effect that reads a browser store has nowhere to
  // put the result except state. That is exactly the shape
  // `react-hooks/set-state-in-effect` flags, and here it is the correct one:
  // the first paint (server and hydration alike) must be `ready: false`, which
  // is what stops the room page redirecting to /join before anyone has looked.
  // `useSyncExternalStore` would express this without an effect, but its
  // client-side behaviour cannot be proven by this project's test setup
  // (vitest runs the edge runtime, with no DOM), and an unproven rewrite of
  // the redirect guard is a worse trade than a named exception.
  useEffect(() => {
    // Both sides of the round trip go through this one pair of functions, so
    // the in-memory fallback closes the loop here for every caller at once.
    const stored = readSessionKey(code);
    // A mount-time read of a browser store has nowhere to land but state, and
    // `ready` must start false so the room page does not redirect to /join
    // before anyone has looked. Full reasoning above the effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSessionKey(stored);
    setReady(true);
  }, [code]);

  const store = useCallback(
    (next: string) => {
      storeSessionKey(code, next);
      setSessionKey(next);
      setReady(true);
    },
    [code],
  );

  return { sessionKey, ready, store };
}
