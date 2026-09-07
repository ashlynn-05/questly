/**
 * What a booked room may honestly say about how many people are coming.
 *
 * THE DECISION, and why, because the next person will want to change it.
 *
 * `bookings.confirm` freezes `headcount` and `totalCents` at the moment the
 * group agrees, and `rooms.leave` has no booked-status guard -- so somebody can
 * drop out afterwards and the two numbers stop describing the same set of
 * people. The screen used to render the frozen count under the present-tense
 * label "Going", which is the one thing PRODUCT.md's honesty rule forbids: a
 * number shown to a user that nothing stands behind.
 *
 * Three options were on the table.
 *
 *  1. Recompute the booking when the roster moves. Rejected. "$28 each between
 *     3" is a number nobody agreed to and no one in the group has seen; the
 *     booking is a record of an agreement, and silently rewriting an agreement
 *     because one person left is worse than the stale label was.
 *  2. Refuse to let anyone leave a booked room. Rejected. People genuinely
 *     cannot make things, and a product that traps you in a night you cannot
 *     attend is a worse product than one that says three of you are going.
 *  3. Keep the record frozen and SHOW BOTH. Chosen.
 *
 * So the booking row never moves, and the screen stops claiming the frozen
 * count is the current one. "Going" becomes the live roster -- the only number
 * that is true in the present tense -- and when the two differ the screen says
 * what the group agreed to as well: "3 going, split between 4 when this was
 * booked". Both numbers then stand behind something real, and the per-head
 * estimate stays the one the group actually saw and agreed to rather than a
 * figure derived after the fact.
 *
 * This is a pure function so it can be tested: the suite runs one edge-runtime
 * with no DOM, so the component that calls it cannot be. See booking.test.ts.
 */
export type BookedHeadcount = {
  /** People in the room right now. Present tense, because the label is. */
  going: number;
  /** The roster the booking was agreed by, and what its total was split between. */
  agreed: number;
  /**
   * The two differ, so the screen has to say both. False is the ordinary case
   * and the screen stays a single number.
   */
  changed: boolean;
  /**
   * The agreed per-head split, in cents. Frozen: it is `totalCents / headcount`
   * as they were at confirm time, never re-divided by the live roster. Zero
   * when there is no agreed headcount to divide by, which the schema does not
   * prevent and division does not survive.
   */
  perHeadCents: number;
};

export function bookedHeadcount(
  booking: { headcount: number; totalCents: number },
  going: number,
): BookedHeadcount {
  const agreed = booking.headcount;
  return {
    going,
    agreed,
    // Not `going < agreed`: `rooms.join` refuses a room that is not in the
    // lobby, so the roster can only shrink today -- but this function should
    // not be the thing that breaks if that ever changes.
    changed: going !== agreed,
    perHeadCents: agreed > 0 ? booking.totalCents / agreed : 0,
  };
}
