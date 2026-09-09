/**
 * The one decision a drag makes, as a pure function.
 *
 * It is here rather than inside the component that drags because
 * `vitest.config.ts` runs the suite on edge-runtime with no DOM: a pointer
 * handler cannot be driven by a test in this repository, and this can. The same
 * split `src/lib/menu.ts` made for the menu keyboard pattern, for the same
 * reason.
 */

/** A quarter of the card, so the gesture is the same shape at every width. */
export const SWIPE_THRESHOLD_RATIO = 0.25;

/**
 * Below this, a "threshold" is a twitch. 25% of a 200px card is 50px, which a
 * thumb crosses while scrolling past.
 */
export const SWIPE_THRESHOLD_MIN = 64;

export function swipeThreshold(width: number): number {
  return Math.max(SWIPE_THRESHOLD_MIN, width * SWIPE_THRESHOLD_RATIO);
}

/**
 * `null` means "not yet" -- the drag is live but has not become a vote.
 *
 * Distance only. `PanInfo.velocity.x` is right there and deliberately unused: a
 * flick should not be able to cast a vote in a decision a whole group is
 * making, and the affordance this drives is a button lighting up, which has to
 * mean "let go now and this happens" rather than "maybe, depending how fast you
 * were going". If that ever changes, this is the one line that changes.
 */
export function swipeIntent(dx: number, width: number): "yes" | "no" | null {
  // `offsetWidth` reads 0 before first layout, and a 0-width card would put the
  // threshold at its floor while the card is not on screen yet -- so every
  // stray pixel would be a vote on a card nobody has seen.
  if (!Number.isFinite(dx) || !Number.isFinite(width) || width <= 0) return null;
  if (Math.abs(dx) < swipeThreshold(width)) return null;
  return dx > 0 ? "yes" : "no";
}
