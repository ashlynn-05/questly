"use client";

import { useCallback, useEffect, useState } from "react";
import { readSessionKey, storeSessionKey } from "@/lib/room/session";

/**
 * The key this device holds for one room, read on mount.
 *
 * Split from the store in `@/lib/room/session` because the store is called from
 * places that are not components -- `rooms.create` resolves a code and a key
 * together, after which no hook can be called -- and because the store half is
 * pure enough to test directly under this suite's `edge-runtime`, which has no
 * DOM at all.
 */
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
