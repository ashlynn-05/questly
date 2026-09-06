import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { throwUserError } from "./errors";
import { recomputeItinerary, totalPerHeadCents, type Stop } from "./stops";

/**
 * The one place a stop is replaced. Recomputes the times after it and re-totals
 * the cost, because a swap that leaves stale times is a plan that lies.
 *
 * It lives here rather than in `convex/plans.ts` because a Convex function file
 * may only export Convex functions -- and because the direct edit path and the
 * accepted-proposal path must run byte-identical code or the two will drift.
 *
 * Every refusal here is something the person tapping "swap" can act on, so it
 * throws through `throwUserError`: a plain `Error` arrives in the browser as
 * "Server Error" on a production deployment, which tells them nothing.
 */
export async function applyStopSwap(
  ctx: MutationCtx,
  roomId: Id<"rooms">,
  stopId: string,
  replacement: Stop,
): Promise<void> {
  // .first(), not .unique(), for the same reason rooms.get uses it: nothing in
  // the schema enforces one plan per room, and .unique() throws on a duplicate,
  // which would lock every edit out of the room permanently. plans.writePlan
  // upserts onto this same row, so the two agree on which row is the plan.
  const plan = await ctx.db
    .query("plans")
    .withIndex("by_room", (q) => q.eq("roomId", roomId))
    .first();
  if (!plan) throwUserError("PLAN_NOT_READY", "There is no plan to edit yet.");

  const room = await ctx.db.get(roomId);
  if (!room) throwUserError("ROOM_NOT_FOUND", "That room is gone.");

  const index = plan.stops.findIndex((s) => s.id === stopId);
  if (index === -1) throwUserError("STOP_NOT_FOUND", "That stop is not in this plan.");
  if (plan.stops[index].locked) {
    throwUserError("STOP_LOCKED", "That stop is locked. Unlock it first.");
  }

  const next = [...plan.stops];
  // The stop keeps its id so open proposals and the UI keep pointing at it.
  next[index] = { ...replacement, id: stopId, locked: false };

  const recomputed = recomputeItinerary(next, room.whenAt);
  await ctx.db.patch(plan._id, {
    stops: recomputed,
    totalPerHeadCents: totalPerHeadCents(recomputed),
  });
}
