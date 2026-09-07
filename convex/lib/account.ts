/**
 * The arithmetic of the deletion window, in one place both sides can read.
 *
 * The backend needs it to decide what to purge; the settings and restore
 * screens need it to tell somebody how long they have left. `/settings` already
 * imports `@convex/lib/quiz` and `@convex/lib/scoring` directly, so this is the
 * established way to share a constant rather than write "14" down twice and
 * watch the two copies part company.
 *
 * Deliberately pure, with `now` passed in rather than read: this is the half of
 * the deletion feature that can be wrong quietly -- an off-by-one on a boundary
 * either purges a day early or leaves a row forever -- so it has to be testable
 * without a clock.
 */

/**
 * How long a deleted account can still be brought back.
 *
 * Long enough that somebody who deleted in a bad mood, or by mis-tap, has a
 * weekend and then some to change their mind; short enough that "deleted"
 * means something. Every screen that mentions deletion states this number, so
 * it is never a surprise.
 */
export const PURGE_WINDOW_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

export const PURGE_WINDOW_MS = PURGE_WINDOW_DAYS * DAY_MS;

/** When a profile tombstoned at `deletedAt` becomes eligible for the purge. */
export function purgeAt(deletedAt: number): number {
  return deletedAt + PURGE_WINDOW_MS;
}

/**
 * Whole days left before the purge, floored at 0.
 *
 * Rounded UP, not down. A window with eleven and a half days to run is "12 days
 * left" rather than "11": rounding down would show "0 days left" for the whole
 * of the final day, which reads as "already gone" to the one person still in a
 * position to stop it.
 */
export function daysLeft(deletedAt: number, now: number): number {
  const remaining = purgeAt(deletedAt) - now;
  if (remaining <= 0) return 0;
  return Math.ceil(remaining / DAY_MS);
}
