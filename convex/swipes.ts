import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { publicMutation } from "./lib/customFunctions";
import { requireMember, roomByCode } from "./lib/rooms/access";
import { throwUserError } from "./lib/errors";
import { resolveMatch } from "./lib/rooms/match";

export const cast = publicMutation({
  args: {
    code: v.string(),
    sessionKey: v.string(),
    questId: v.id("quests"),
    dir: v.union(v.literal("yes"), v.literal("no")),
  },
  returns: v.object({
    matched: v.boolean(),
    questId: v.union(v.id("quests"), v.null()),
  }),
  handler: async (ctx, args): Promise<{ matched: boolean; questId: Id<"quests"> | null }> => {
    const room = await roomByCode(ctx, args.code);
    // Authorisation is the sessionKey and nothing else: it is a capability to
    // act as one member in one room. No memberId is accepted from the client,
    // so nobody can cast a swipe in somebody else's name.
    const member = await requireMember(ctx, room._id, args.sessionKey);

    // A late swipe from a slow phone must not reopen a decided room.
    // `resolveMatch` refuses to re-declare a decided room too, so this is the
    // shape of the answer rather than the guard itself.
    if (room.status === "matched" || room.status === "booked") {
      return { matched: true, questId: room.matchedQuestId ?? null };
    }

    if (room.status !== "swiping") {
      throwUserError("ROOM_WRONG_STATE", "This room is not swiping yet.");
    }

    const quests = await ctx.db
      .query("quests")
      .withIndex("by_room_rank", (q) => q.eq("roomId", room._id))
      .order("asc")
      .collect();

    // An empty deck has no valid questId to arrive with, so this is checked
    // BEFORE the quest is validated: a check placed after that validation could
    // never run for the very room that needs it. The recovery itself (back to
    // the lobby, where the host still has the build button) belongs to
    // `resolveMatch`, so there is only ever one copy of it.
    if (quests.length === 0) {
      const winner = await resolveMatch(ctx, room._id, member);
      return { matched: winner !== null, questId: winner };
    }

    // The card must belong to THIS room. `questId` is a client-supplied id used
    // as a foreign key on the row we are about to write; without this, a member
    // of room A could pin swipes onto room B's cards, and those rows would then
    // be counted in room B's unanimity.
    const quest = quests.find((q) => q._id === args.questId);
    if (!quest) throwUserError("QUEST_NOT_FOUND", "That card is not in this room's deck.");

    // Only this member's rows, to decide whether this swipe is new. The tally
    // itself is `resolveMatch`'s job and reads the swipes back after this
    // write.
    const mine = await ctx.db
      .query("swipes")
      .withIndex("by_room_member", (q) => q.eq("roomId", room._id).eq("memberId", member._id))
      .collect();

    // Idempotent: a double-tap or a reconnect re-swiping the same card
    // overwrites rather than duplicating. Two rows for one member on one card
    // would let a single person supply another person's missing yes.
    const existing = mine.find((s) => s.questId === quest._id);
    if (!existing) {
      await ctx.db.insert("swipes", {
        roomId: room._id,
        questId: quest._id,
        memberId: member._id,
        dir: args.dir,
      });
    } else if (existing.dir !== args.dir) {
      // Changing your mind is a patch. An identical re-send writes nothing at
      // all, so a retrying client cannot churn the row other phones subscribe to.
      await ctx.db.patch(existing._id, { dir: args.dir });
    }

    // Unanimity, exhaustion, the winner and the plan hand-off all live in
    // `lib/match.ts`, because `rooms.leave` and `rooms.removeMember` have to
    // run byte-identical logic when the roster -- the other half of both
    // conditions -- shrinks.
    const winner = await resolveMatch(ctx, room._id, member);
    return { matched: winner !== null, questId: winner };
  },
});
