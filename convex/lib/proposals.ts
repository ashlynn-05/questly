import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { memberCount, needed } from "./access";
import { applyStopSwap } from "./swap";

type ProposalStatus = Doc<"proposals">["status"];

/**
 * The one place a proposal's outcome is decided.
 *
 * Every caller -- opening a proposal, voting on one, or a roster that just
 * shrank -- runs this same arithmetic against the CURRENT roster, so there is
 * no second threshold anywhere that could drift from `needed()`. No count is
 * ever written as a literal: `needed(n)` is `Math.floor(n / 2) + 1`, and that
 * function is the only definition of a majority in the backend.
 *
 * It resolves in BOTH directions, and that is what keeps a proposal from
 * hanging:
 *
 *  - enough yeses for the roster as it stands now -> apply the swap and accept,
 *    the instant the majority exists rather than whenever the next vote lands;
 *  - not enough undecided members left to ever reach it -> reject, because
 *    every remaining vote has already been cast (or the people who would have
 *    cast them are gone) and nothing further will ever arrive.
 *
 * Both directions matter after `rooms.leave` / `rooms.removeMember`: the
 * denominator moves under an open proposal, and if nobody re-ran this the
 * proposal would sit open forever waiting on a vote that can never come.
 *
 * The votes are re-read here rather than passed in so this tally can never
 * disagree with what is actually stored.
 */
export async function settleProposal(
  ctx: MutationCtx,
  proposal: Doc<"proposals">,
): Promise<ProposalStatus> {
  if (proposal.status !== "open") return proposal.status;

  const total = await memberCount(ctx, proposal.roomId);
  const votes = await ctx.db
    .query("proposalVotes")
    .withIndex("by_proposal", (q) => q.eq("proposalId", proposal._id))
    .collect();

  const yes = votes.filter((row) => row.vote === "yes").length;
  const need = needed(total);
  // A departing member's votes are deleted with them, so `votes` should never
  // outnumber the roster. Clamped anyway: a negative "undecided" would let a
  // reachable proposal look unreachable and be rejected out from under the room.
  const undecided = Math.max(0, total - votes.length);

  if (yes >= need) {
    await applyStopSwap(ctx, proposal.roomId, proposal.stopId, proposal.replacement);
    await ctx.db.patch(proposal._id, { status: "accepted" });
    return "accepted";
  }

  if (yes + undecided < need) {
    await ctx.db.patch(proposal._id, { status: "rejected" });
    return "rejected";
  }

  return "open";
}

/**
 * Re-decide every open proposal in a room whose roster has just changed.
 *
 * Called from the two places a member disappears (`rooms.leave` and
 * `rooms.removeMember`). Without it, a proposal that the shrunken roster has
 * already agreed on -- or one it can no longer possibly agree on -- stays open
 * until some later vote happens to arrive, and if the people who would have
 * voted are the ones who left, that is never.
 *
 * A blocked swap must not take the departure down with it: someone leaving a
 * room cannot be made to fail because a stop was locked after their proposal
 * was opened. `applyStopSwap` validates everything before its single patch, so
 * a throw from it has written nothing; the proposal is closed as rejected and
 * the room is free to propose the change again.
 */
export async function resolveOpenProposals(
  ctx: MutationCtx,
  roomId: Id<"rooms">,
): Promise<void> {
  const open = await ctx.db
    .query("proposals")
    .withIndex("by_room_status", (q) => q.eq("roomId", roomId).eq("status", "open"))
    .collect();

  for (const proposal of open) {
    try {
      await settleProposal(ctx, proposal);
    } catch (error) {
      console.warn(
        `resolveOpenProposals: could not apply proposal ${proposal._id}; closing it as rejected.`,
        error,
      );
      await ctx.db.patch(proposal._id, { status: "rejected" });
    }
  }
}
