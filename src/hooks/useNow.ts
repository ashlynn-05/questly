"use client";

import { useSyncExternalStore } from "react";

/**
 * The clock, as an external store.
 *
 * `Date.now()` cannot be called during a render -- it is impure, the lint rule
 * that enforces that is on, and the reason behind the rule is real: a render
 * may run twice and must agree with itself. `useSyncExternalStore` is the
 * escape hatch React provides for exactly this, and the funnel in `/start`
 * already uses it for the same reason. React calls the snapshot; the render
 * does not.
 *
 * The snapshot is quantised to the tick so it is stable between the two calls
 * React makes around a subscription. An unquantised `Date.now()` would be a
 * different value every single time it was asked, which is what makes a clock
 * in this hook loop.
 *
 * Its own file, separate from `useCountdown`, because the deck reads the clock
 * directly -- it mints a card key from it -- and has no deadline to count to.
 * A screen that wants the time should not have to import a countdown.
 */

/** A quarter second. See the note on throttling in `useCountdown`. */
export const TICK_MS = 250;

function subscribe(onChange: () => void): () => void {
  const id = window.setInterval(onChange, TICK_MS);
  return () => window.clearInterval(id);
}
const noSubscribe = (): (() => void) => () => {};
const nowSnapshot = (): number => Math.floor(Date.now() / TICK_MS);
/** Nothing is counting down on the server, and nothing is counting down off. */
const frozenSnapshot = (): number => 0;

/**
 * The current time in milliseconds, re-read every tick, or 0 when nothing on
 * this screen is counting.
 *
 * Subscribing only when something is running matters: a room with no timer and
 * no open vote should not have an interval in it at all.
 */
export function useNow(active: boolean): number {
  const bucket = useSyncExternalStore(
    active ? subscribe : noSubscribe,
    active ? nowSnapshot : frozenSnapshot,
    frozenSnapshot,
  );
  return bucket * TICK_MS;
}
