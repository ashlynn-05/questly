/**
 * The arithmetic behind every countdown on screen: the card timer in the deck
 * and the vote window on the plan.
 *
 * A deadline is an INSTANT, never a remaining count. A number that ticks down
 * in state is wrong the moment the tab is backgrounded -- browsers throttle
 * timers to once a minute or stop them entirely, and a phone that comes back
 * after two minutes asleep would resume from where it fell asleep and give
 * whoever is holding it a card everyone else has already passed. Deriving the
 * remaining seconds from `Date.now()` on every tick makes a slept-through tab
 * arrive at the correct answer, which is usually "that ran out".
 */

/**
 * Whole seconds left, floored at zero.
 *
 * Rounded UP so a thirty second timer reads "30" on the first frame rather than
 * "29", and so the last whole second reads "1" rather than "0" -- zero is
 * reserved for actually being out of time, which is the value the caller acts
 * on.
 */
export function secondsLeft(deadlineAt: number, now: number): number {
  return Math.max(0, Math.ceil((deadlineAt - now) / 1000));
}

/** "1:05", "0:09", "2:00" -- minutes for a vote window, which runs long. */
export function clockFace(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}
