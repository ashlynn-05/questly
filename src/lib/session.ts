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
