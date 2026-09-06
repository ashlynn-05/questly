import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { resolveMatch } from "./match";
import { resolveOpenProposals } from "./proposals";

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

  await ctx.db.delete(member._id);

  // Last, and only once the roster is genuinely smaller: the denominator that
  // both of these are measured against has just changed.
  await resolveOpenProposals(ctx, member.roomId);
  await resolveMatch(ctx, member.roomId);
}
