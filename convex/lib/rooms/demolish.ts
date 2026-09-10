import type { Doc } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { dropOwner, seatOwnerKey } from "../push/notify";

/**
 * Take a room off the board, and everything filed under it with it.
 *
 * WHY THIS EXISTS AT ALL. Until now nothing in this product could close a room:
 * `rooms.leave` throws HOST_CANNOT_LEAVE for the host, there is no cancel, and
 * a `lobby` room nobody ever started stayed `lobby` for good. The cost of that
 * is written down in `convex/account.ts`, which had to weaken its own refusal
 * because it could not name an action the product actually had. A mistyped date
 * is not a night, and a host had no way to say so.
 *
 * WHY NOT `detachMember` IN A LOOP. That helper is the shared cleanup for one
 * person leaving a room that CONTINUES without them, so after every seat it
 * re-decides the open proposals and the match against the smaller roster. Run
 * per member over a whole room it would do that work once per seat, on a room
 * about to stop existing, and could walk the room through `matched` on the way
 * to being deleted -- firing whatever a status change fires. Nothing here needs
 * re-deciding, because there is nothing left to decide it for.
 *
 * WHY `collect` AND NOT A BOUNDED `take`. The house rule guards against reads
 * that grow with a TABLE. Every range below is one room's own rows on a
 * dedicated index, and each is capped by something the product already
 * enforces: the deck is `DECK_SIZE` cards, the roster is capped by ROOM_FULL,
 * and swipes are the product of the two. A ceiling here would not be a safety
 * margin -- it would leave orphan rows pointing at a room id that no longer
 * resolves, which is the exact failure this function exists to prevent.
 * `convex/account.ts` departs from the same rule for the same reason.
 *
 * AUTHORISATION IS THE CALLER'S JOB. This is handed an already-resolved room
 * and cannot tell a host closing their own room from anything else.
 */
export async function demolishRoom(ctx: MutationCtx, room: Doc<"rooms">): Promise<void> {
  const roomId = room._id;

  const bookings = await ctx.db
    .query("bookings")
    .withIndex("by_room", (q) => q.eq("roomId", roomId))
    .collect();
  for (const booking of bookings) {
    await ctx.db.delete(booking._id);
  }

  const plans = await ctx.db
    .query("plans")
    .withIndex("by_room", (q) => q.eq("roomId", roomId))
    .collect();
  for (const plan of plans) {
    await ctx.db.delete(plan._id);
  }

  // Votes before proposals, so nothing is ever filed under a proposal that has
  // already gone. `by_room_status` is used as a roomId-only prefix, which is
  // what makes this every proposal in the room rather than the open ones.
  const proposals = await ctx.db
    .query("proposals")
    .withIndex("by_room_status", (q) => q.eq("roomId", roomId))
    .collect();
  for (const proposal of proposals) {
    const votes = await ctx.db
      .query("proposalVotes")
      .withIndex("by_proposal", (q) => q.eq("proposalId", proposal._id))
      .collect();
    for (const vote of votes) {
      await ctx.db.delete(vote._id);
    }
    await ctx.db.delete(proposal._id);
  }

  const finalizeVotes = await ctx.db
    .query("finalizeVotes")
    .withIndex("by_room", (q) => q.eq("roomId", roomId))
    .collect();
  for (const vote of finalizeVotes) {
    await ctx.db.delete(vote._id);
  }

  // Same prefix trick: `by_room_quest` keyed on the room alone is every swipe
  // cast in it, which is what has to go rather than one card's worth.
  const swipes = await ctx.db
    .query("swipes")
    .withIndex("by_room_quest", (q) => q.eq("roomId", roomId))
    .collect();
  for (const swipe of swipes) {
    await ctx.db.delete(swipe._id);
  }

  const quests = await ctx.db
    .query("quests")
    .withIndex("by_room_rank", (q) => q.eq("roomId", roomId))
    .collect();
  for (const quest of quests) {
    await ctx.db.delete(quest._id);
  }

  const members = await ctx.db
    .query("members")
    .withIndex("by_room", (q) => q.eq("roomId", roomId))
    .collect();
  for (const member of members) {
    // Anything a GUEST subscribed to from this room, which is filed under the
    // seat because a guest has no other identity. `seatOwnerKey` and not
    // `ownerKey`, exactly as `detachMember` has it: a signed-in member's
    // subscriptions belong to their account and must survive the room they
    // happened to turn them on in.
    await dropOwner(ctx, seatOwnerKey(member._id));
    await ctx.db.delete(member._id);
  }

  await ctx.db.delete(roomId);
}
