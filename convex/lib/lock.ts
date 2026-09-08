import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { throwUserError } from "./errors";

/**
 * The one place a stop's lock is written.
 *
 * It exists for the same reason `applyStopSwap` does: there are now two ways a
 * lock can land -- somebody taps it in a room whose `lockRule` is "anyone", or
 * a room whose rule is "vote" carries a lock proposal -- and the two must write
 * byte-identical rows. A second copy would eventually clear `lockedBy` on one
 * path and leave it on the other, and the stale attribution would survive
 * because nothing renders the difference.
 *
 * Unlike a swap, this deliberately does NOT refuse a locked stop: unlocking one
 * is the whole of half its job.
 *
 * Authorisation and the booked-room freeze are the CALLER's, exactly as in
 * `applyStopSwap`: `roomId` arrives already resolved, so this helper cannot
 * tell a member from a stranger.
 */
export async function applyStopLock(
  ctx: MutationCtx,
  roomId: Id<"rooms">,
  stopId: string,
  locked: boolean,
  /** Whose lock to say it is, or null to record it without a name. */
  by: string | null,
): Promise<void> {
  // .first(), not .unique(), for the reason documented at length in rooms.get:
  // a duplicate plan row must not turn into a throw on every edit in the room.
  const plan = await ctx.db
    .query("plans")
    .withIndex("by_room", (q) => q.eq("roomId", roomId))
    .first();
  if (!plan) throwUserError("PLAN_NOT_READY", "There is no plan to edit yet.");

  // A typo'd stop id must not report success while changing nothing.
  if (!plan.stops.some((s) => s.id === stopId)) {
    throwUserError("STOP_NOT_FOUND", "That stop is not in this plan.");
  }

  await ctx.db.patch(plan._id, {
    stops: plan.stops.map((s) => {
      if (s.id !== stopId) return s;
      // `lockedBy` is dropped first and re-added only on a lock. Cleared on
      // unlock rather than left behind: a stale "locked by Tam" on an unlocked
      // stop is a lie, and it is the sort that survives because nothing
      // renders it.
      const { lockedBy: _was, ...rest } = s;
      if (!locked) return { ...rest, locked: false };
      return by === null ? { ...rest, locked: true } : { ...rest, locked: true, lockedBy: by };
    }),
  });
}
