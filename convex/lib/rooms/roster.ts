import type { Doc } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { resolveMatch } from "./match";
import { presence } from "../../presence";
import { dropOwner, seatOwnerKey } from "../push/notify";
import { resolveOpenProposals } from "../plans/proposals";
import { clearFinalizeVotes } from "./rules";

/**
 * Take a member off the roster, and take everything that counted for them with
 * it.
 *
 * The one implementation, shared by `rooms.leave` (you bail) and
 * `rooms.removeMember` (the host removes someone who cannot bail -- a guest row
 * nobody holds the session key for). A second copy would drift, and the two
 * paths must clean up identically or unanimity and majority end up judged
 * against different rosters depending on how the person left.
 *
 * What goes:
 *  - their swipes, so unanimity is judged on who is actually present;
 *  - their proposal votes, so a majority is judged on who is actually present;
 *  - the member row itself, which is the denominator both of those use.
 *
 * And then the two things that are quantified over the roster are re-decided,
 * because the roster just moved under both of them:
 *  - every open proposal (`resolveOpenProposals`), and
 *  - the match itself (`resolveMatch`).
 *
 * The second one is a deadlock fix, not a nicety. Three people, two of whom
 * swipe the whole deck, and the third leaves: the deck is exhausted and every
 * remaining member is done, so the room should resolve -- but there are no
 * cards left for anyone to swipe, so if resolution only ran inside
 * `swipes.cast` nothing would ever evaluate it and the room would hang on
 * "swiping" forever.
 *
 * Authorisation is the CALLER's job: this helper is handed an already-resolved
 * member row and cannot tell a self-departure from a host removal.
 */
export async function detachMember(ctx: MutationCtx, member: Doc<"members">): Promise<void> {
  const swipes = await ctx.db
    .query("swipes")
    .withIndex("by_room_member", (q) =>
      q.eq("roomId", member.roomId).eq("memberId", member._id),
    )
    .collect();
  for (const swipe of swipes) {
    await ctx.db.delete(swipe._id);
  }

  const votes = await ctx.db
    .query("proposalVotes")
    .withIndex("by_member", (q) => q.eq("memberId", member._id))
    .collect();
  for (const vote of votes) {
    await ctx.db.delete(vote._id);
  }

  // Anything this browser subscribed to as a GUEST, which is filed under the
  // seat because a guest has no other identity. The seat is going, so it goes
  // with it -- an endpoint left pointing at a member row that no longer exists
  // is a subscription nothing will ever send to and nothing will ever clean up.
  //
  // `seatOwnerKey` and not `ownerKey`: a signed-in member's subscriptions are
  // filed under their ACCOUNT and must survive this. Leaving one room is not
  // turning notifications off everywhere.
  await dropOwner(ctx, seatOwnerKey(member._id));

  // Same argument, one component over. Presence is keyed on the seat, and the
  // seat is going: left alone the component would hold a row per departed
  // member forever, since nothing else ever reaps one. Nobody would see it --
  // the lobby only asks about members still on the roster -- which is exactly
  // why it would never get noticed.
  await presence.removeRoomUser(ctx, member.roomId, member._id);

  await ctx.db.delete(member._id);

  // Last, and only once the roster is genuinely smaller: the denominator that
  // both of these are measured against has just changed.
  //
  // Except in a booked room, where re-deciding an open proposal is the fifth
  // door into a frozen plan. A smaller roster is a smaller majority, so a
  // proposal sitting one yes short at booking time would PASS the moment a
  // member who never voted walked away -- and `settleProposal` would apply the
  // swap, rewriting the itinerary the group is holding a reference to and
  // leaving the booking row quoting a total for a night that no longer exists.
  //
  // The votes above are still deleted: the leaver takes what counted for them
  // with them either way. It is only the resolve-and-apply step that must not
  // run. `resolveMatch` needs no such guard -- it already returns early on a
  // matched or booked room -- and this makes the roster module consistent with
  // it rather than relying on every future caller to remember.
  const room = await ctx.db.get(member.roomId);
  if (room?.status !== "booked") {
    await resolveOpenProposals(ctx, member.roomId);

    // And the whole finalize vote, not only the leaver's row.
    //
    // The other two are re-decided against the smaller roster. This one is
    // ABANDONED against it, and the difference is what a yes here means:
    // `bookings.confirm` freezes `headcount` and `totalCents` at the moment it
    // writes, so a yes cast while four people were splitting the bill is not
    // consent to three people splitting it. Re-deciding would book the night
    // on the strength of votes for a different night -- and it would do it
    // from inside `rooms.leave`, which is not a place a booking should be able
    // to appear from. Everyone still in the room votes again, on the room they
    // are actually in.
    await clearFinalizeVotes(ctx, member.roomId);
    if (room?.finalizeStartedAt !== undefined) {
      await ctx.db.patch(member.roomId, { finalizeStartedAt: undefined });
    }
  }
  await resolveMatch(ctx, member.roomId);
}
