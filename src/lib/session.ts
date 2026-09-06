"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * A guest's proof that they belong to a room. Stored per-room so one device can
 * hold two rooms at once -- which is exactly what happens when the app is
 * demoed on a laptop and a phone side by side.
 */
const keyFor = (code: string) => `questly-session-${code}`;

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
      try {
        localStorage.setItem(keyFor(code), next);
      } catch {
        // Still works for this page's lifetime; only survival is lost.
      }
      setSessionKey(next);
      setReady(true);
    },
    [code],
  );

  return { sessionKey, ready, store };
}
