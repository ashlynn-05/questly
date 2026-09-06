import { v } from "convex/values";
import { mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { stopValidator } from "./schema";
import { requireMember, roomByCode } from "./lib/access";
import { throwUserError } from "./lib/errors";
import { settleProposal } from "./lib/proposals";

/**
 * How a group of two or more changes its plan.
 *
 * Nobody edits a shared night out on their own: a change is proposed, the room
 * votes, and a majority of the people actually in the room carries it. That is
 * the whole point -- the plan belongs to the room, so no one person's ego is
 * attached to a stop and no one person can quietly overwrite someone else's.
 *
 * `plans.replaceStop` is the other half of the same rule, and the two never
 * overlap: it is refused outright in a room of two or more, so a group's plan
 * has exactly one write path and it is this one.
 */

export const open = mutation({
  args: {
    code: v.string(),
    sessionKey: v.string(),
    stopId: v.string(),
    replacement: stopValidator,
    reason: v.string(),
  },
  returns: v.object({ proposalId: v.id("proposals"), accepted: v.boolean() }),
  handler: async (
    ctx,
    args,
  ): Promise<{ proposalId: Id<"proposals">; accepted: boolean }> => {
    const room = await roomByCode(ctx, args.code);
    // The sessionKey and nothing else. No memberId is accepted from the client,
    // so nobody can open a proposal -- or cast its opening yes -- in someone
    // else's name.
    const member = await requireMember(ctx, room._id, args.sessionKey);

    // One open proposal per stop. Two live proposals on one stop would let the
    // room vote twice on the same slot and have the loser overwrite the winner
    // depending on which majority landed second.
    //
    // `by_room_stop` narrows to this room's proposals for this one stop -- a
    // handful of rows -- and the status is filtered off that, since it is not
    // an index column.
    const clash = await ctx.db
      .query("proposals")
      .withIndex("by_room_stop", (q) => q.eq("roomId", room._id).eq("stopId", args.stopId))
      .filter((q) => q.eq(q.field("status"), "open"))
      .first();
    if (clash) {
      throwUserError("PROPOSAL_EXISTS", "Someone has already proposed a change to that stop.");
    }

    // Fail fast, on the person who caused it.
    //
    // `applyStopSwap` re-checks all of this and remains the authority; without
    // this, a proposal against a missing or locked stop would sit open until
    // the majority landed and then throw at whoever happened to cast the
    // deciding vote -- an error about someone else's mistake.
    //
    // .first(), not .unique(), for the reason documented in rooms.get.
    const plan = await ctx.db
      .query("plans")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .first();
    if (!plan) throwUserError("PLAN_NOT_READY", "There is no plan to edit yet.");

    const current = plan.stops.find((s) => s.id === args.stopId);
    if (!current) throwUserError("STOP_NOT_FOUND", "That stop is not in this plan.");
    if (current.locked) {
      throwUserError("STOP_LOCKED", "That stop is locked. Unlock it first.");
    }

    const proposalId = await ctx.db.insert("proposals", {
      roomId: room._id,
      stopId: args.stopId,
      proposedBy: member._id,
      replacement: args.replacement,
      reason: args.reason,
      status: "open",
    });

    // Proposing is agreeing. Recorded as a real row rather than implied by
    // `proposedBy`, so one tally counts every yes the same way -- and so it is
    // deleted with the proposer if they leave, instead of a phantom yes
    // outliving them.
    await ctx.db.insert("proposalVotes", { proposalId, memberId: member._id, vote: "yes" });

    const proposal = await ctx.db.get(proposalId);
    // Not user-actionable: the row was inserted two lines up in this same
    // transaction, so this is a broken backend, not a broken request.
    if (!proposal) throw new Error("proposals.open: the proposal vanished mid-transaction.");

    // In a room of one, needed(1) is 1, so proposing carries it immediately.
    // The threshold is never written here as a literal -- settleProposal is the
    // only place a majority is decided.
    const status = await settleProposal(ctx, proposal);
    return { proposalId, accepted: status === "accepted" };
  },
});

export const vote = mutation({
  args: {
    code: v.string(),
    sessionKey: v.string(),
    proposalId: v.id("proposals"),
    vote: v.union(v.literal("yes"), v.literal("no")),
  },
  returns: v.object({ accepted: v.boolean() }),
  handler: async (ctx, args): Promise<{ accepted: boolean }> => {
    const room = await roomByCode(ctx, args.code);
    const member = await requireMember(ctx, room._id, args.sessionKey);

    const proposal = await ctx.db.get(args.proposalId);
    // The room is checked as well as the id: `proposalId` is client-supplied,
    // and a proposal id from another room is not a vote here. Without this, a
    // member of any room could vote on any room's plan.
    if (!proposal || proposal.roomId !== room._id) {
      throwUserError("PROPOSAL_NOT_FOUND", "No such proposal.");
    }

    // A vote that arrives after the room already decided reports the outcome
    // rather than re-applying it: re-running an accepted swap would overwrite
    // whatever the room has done to that stop since.
    if (proposal.status !== "open") return { accepted: proposal.status === "accepted" };

    const existing = await ctx.db
      .query("proposalVotes")
      .withIndex("by_proposal", (q) => q.eq("proposalId", args.proposalId))
      .collect();

    // One row per member: changing your mind is a patch, never a second yes.
    // Two rows for one person would let one member supply another's missing
    // vote and carry a majority on their own. (No `v` as a parameter name
    // anywhere in this file -- it would shadow the `v` every validator above
    // is built from.)
    const mine = existing.find((row) => row.memberId === member._id);
    if (!mine) {
      await ctx.db.insert("proposalVotes", {
        proposalId: args.proposalId,
        memberId: member._id,
        vote: args.vote,
      });
    } else if (mine.vote !== args.vote) {
      await ctx.db.patch(mine._id, { vote: args.vote });
    }
    // An identical re-send writes nothing at all, so a retrying client cannot
    // churn a row every other phone in the room is subscribed to.

    // Resolves the instant the majority lands -- no timer, no dead air.
    //
    // If the deciding yes cannot be applied -- somebody locked the stop after
    // the proposal was opened -- this throws STOP_LOCKED at the voter and the
    // proposal survives. Deliberately different from the roster-change path in
    // `resolveOpenProposals`, which closes such a proposal instead: there,
    // nobody is watching and a throw would block a member from leaving; here,
    // there is a person on the other end, the message tells them exactly what
    // to do, and their vote is still counted once the stop is unlocked.
    const status = await settleProposal(ctx, proposal);
    return { accepted: status === "accepted" };
  },
});
