import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
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
  }
  await resolveMatch(ctx, member.roomId);
}

/**
 * The picture beside each name in a room, for the members who have one.
 *
 * WHAT A ROOM KNEW ABOUT ITS PEOPLE BEFORE THIS: a string. The lobby drew
 * twelve identical stops on the line with twelve names beside them, and the
 * account screen was the only place in the product a picture was ever shown --
 * uploaded, cropped to a roundel, and then never seen by anybody the person was
 * going out with. This is the one screen where knowing which of two Bens is in
 * the room is worth anything.
 *
 * ONLY MEMBERS WITH AN ACCOUNT GET ONE, and that is the design, not a
 * limitation. A guest joined with a first name typed at the door and no account
 * behind it -- `rooms.join` takes `userId` only when it happens to be there --
 * so there is no picture to show and nothing to invent. A drawn stand-in would
 * be worse than the name alone: initials on a coloured disc read as a photo at
 * a glance and would quietly claim an identity the room never established.
 *
 * A TOMBSTONED ACCOUNT SHOWS NOTHING. `account.deleteAccount` detaches every
 * seat, so this is a narrow window -- a seat in a room the delete could not
 * reach, or a read racing the delete -- but the rule `profiles.me` states holds
 * here too: to the rest of the product a deleted account has no profile.
 *
 * COST. One indexed lookup and one `getUrl` per SIGNED-IN member, on a roster
 * `rooms.join` caps at MAX_ROOM_MEMBERS, inside the one subscription the whole
 * product runs on. Bounded, and deduped by `userId` so the same account read
 * twice costs one lookup -- which matters less than it reads, since a second
 * seat for one account is exactly what `rooms.join` refuses to create.
 */
export async function memberFaces(
  ctx: QueryCtx,
  members: Doc<"members">[],
): Promise<Map<string, string | null>> {
  const byUser = new Map<string, string | null>();

  for (const userId of new Set(members.flatMap((m) => (m.userId ? [m.userId] : [])))) {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    const url =
      profile && profile.deletedAt === undefined && profile.avatarId
        ? // Null for an id whose file is gone -- a purge, a failed upload. The
          // row falls back to the name, which is the same thing it does for a
          // guest, so there is nothing here worth throwing over.
          await ctx.storage.getUrl(profile.avatarId)
        : null;

    byUser.set(userId, url);
  }

  return new Map(members.map((m) => [m._id, (m.userId ? byUser.get(m.userId) : null) ?? null]));
}
