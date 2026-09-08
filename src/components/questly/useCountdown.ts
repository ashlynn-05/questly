"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { secondsLeft } from "@/lib/countdown";

/** A quarter second. See the note on throttling below. */
const TICK_MS = 250;

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
 */
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

/**
 * Seconds remaining until an instant, and a call when it runs out.
 *
 * Two screens count down -- the card timer in the deck and the vote window on
 * the plan -- and both need the same three properties, so both get them here
 * rather than from two copies of the same effect.
 *
 * The count is DERIVED from the clock above rather than stored and decremented.
 * A stored count is as old as the last tick that was allowed to run, and a
 * background tab is exactly where that goes wrong: browsers throttle
 * `setInterval` to once a second and often to once a minute, so a phone that
 * spent two minutes asleep would come back and resume its countdown from where
 * it fell asleep. Deriving it means that phone arrives at the truth, which is
 * usually "that ran out".
 *
 * The tick is a quarter second rather than a whole one. Not for the display,
 * which changes at most once a second, but so the first tick after a tab wakes
 * up is nearly immediate rather than up to a second of nothing happening.
 */
export function useCountdown(deadlineAt: number | null, onExpire?: () => void): number | null {
  const now = useNow(deadlineAt !== null);

  // Read through a ref so a caller that builds a fresh closure every render
  // does not tear the expiry timer down and rebuild it, which would restart the
  // window and mean it could never actually run out.
  const expire = useRef(onExpire);
  useEffect(() => {
    expire.current = onExpire;
  }, [onExpire]);

  /**
   * Expiry runs off its own interval rather than off the rendered count.
   *
   * Two reasons. It does not then depend on a render landing -- a busy main
   * thread cannot quietly extend somebody's turn -- and it keeps the call out
   * of a render-driven effect, where the state the callback sets would be the
   * cascading-render shape the lint rule refuses.
   *
   * `fired` is local to the effect, so a new deadline is a re-armed timer and
   * the same deadline can only fire once.
   */
  useEffect(() => {
    if (deadlineAt === null) return;
    let fired = false;
    const id = window.setInterval(() => {
      if (fired || Date.now() < deadlineAt) return;
      fired = true;
      expire.current?.();
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [deadlineAt]);

  return deadlineAt === null ? null : secondsLeft(deadlineAt, now);
}
