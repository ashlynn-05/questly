"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * A guest's proof that they belong to a room. Stored per-room so one device can
 * hold two rooms at once -- which is exactly what happens when the app is
 * demoed on a laptop and a phone side by side.
 */
const keyFor = (code: string) => `questly-session-${code}`;

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
  try {
    localStorage.setItem(keyFor(code), key);
  } catch {
    // Still works for this page's lifetime; only survival is lost.
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

  useEffect(() => {
    setReady(false);
    try {
      setSessionKey(localStorage.getItem(keyFor(code)));
    } catch {
      setSessionKey(null); // private browsing -- the room asks them to rejoin
    }
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
