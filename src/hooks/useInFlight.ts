"use client";

import { useCallback, useRef } from "react";

/**
 * One write at a time, held in a ref rather than in `disabled` state.
 *
 * THE REF IS THE POINT, and it is the same lesson three screens learned
 * separately. `Plate` expresses disabled by DROPPING its fill -- right for "not
 * available yet", wrong for "your own tap is in flight", so every swipe used to
 * flash the "I'm in" plate from filled orange to a dashed ghost and back. Worse,
 * disabling the control that currently HAS focus hands focus to <body>, which is
 * exactly the failure the deck, the plan screen and `ConfirmButton` each carry a
 * comment about. A ref stops a second concurrent call and renders nothing.
 *
 * It is also the stricter guard: it is set synchronously, so it does not depend
 * on a re-render landing between two taps, and it cannot go stale inside a
 * `useCallback` closure the way a captured state value can.
 *
 * The caller keeps its own try/catch -- what a failure means and what to say
 * about it is per screen -- and this owns only the flag and the release.
 */
export function useInFlight(): (work: () => Promise<void>) => Promise<void> {
  const busy = useRef(false);
  return useCallback(async (work: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    try {
      await work();
    } finally {
      busy.current = false;
    }
  }, []);
}
