import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireMember, roomByCode } from "./lib/access";
import { throwUserError } from "./lib/errors";

/**
 * The exhaustion fallback's winner: the genuinely top-scored card.
 *
 * `deck.build` writes `rank: i` over a list it has already sorted by descending
 * score, so for every deck this app builds rank order IS score order and this
 * returns `quests[0]`. Sorting on `score` anyway is not redundancy: a deck
 * written by a seed script, a fixture, or a future ranker that separates
 * presentation order from quality would otherwise silently declare the wrong
 * venue, and "top-scored" is what the product promises. `rank` breaks ties so
 * two equally scored cards resolve deterministically rather than by whatever
 * order the index scan happened to return.
 */
function topScored(quests: Doc<"quests">[]): Doc<"quests"> {
  return [...quests].sort((a, b) => b.score - a.score || a.rank - b.rank)[0];
}

export const cast = mutation({
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

    // A late swipe from a slow phone must not reopen a decided room. This is
    // also what makes the match itself idempotent: once `status` is "matched",
    // no further call can reach the patch below, so a room can never match
    // twice or schedule a second plan build.
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

    // A swiping room with no cards is the one state that can neither match nor
    // exhaust, so it would wait forever -- and the match may never deadlock.
    // Hand it back to the lobby, where the host still has the build button, the
    // same recovery `deck.abandonBuild` performs for a build that found nothing.
    // Checked before the quest is validated on purpose: with an empty deck
    // there is no valid questId to arrive with, so a check placed after that
    // validation could never run.
    if (quests.length === 0) {
      await ctx.db.patch(room._id, { status: "lobby" });
      return { matched: false, questId: null };
    }

    // The card must belong to THIS room. `questId` is a client-supplied id used
    // as a foreign key on the row we are about to write; without this, a member
    // of room A could pin swipes onto room B's cards, and those rows would then
    // be counted in room B's unanimity.
    const quest = quests.find((q) => q._id === args.questId);
    if (!quest) throwUserError("QUEST_NOT_FOUND", "That card is not in this room's deck.");

    // Idempotent: a double-tap or a reconnect re-swiping the same card
    // overwrites rather than duplicating. Two rows for one member on one card
    // would let a single person supply another person's missing yes.
    const onThisQuest = await ctx.db
      .query("swipes")
      .withIndex("by_room_quest", (q) => q.eq("roomId", room._id).eq("questId", quest._id))
      .collect();
    const mine = onThisQuest.find((s) => s.memberId === member._id);
    if (!mine) {
      await ctx.db.insert("swipes", {
        roomId: room._id,
        questId: quest._id,
        memberId: member._id,
        dir: args.dir,
      });
    } else if (mine.dir !== args.dir) {
      // Changing your mind is a patch. An identical re-send writes nothing at
      // all, so a retrying client cannot churn the row other phones subscribe to.
      await ctx.db.patch(mine._id, { dir: args.dir });
    }

    const members = await ctx.db
      .query("members")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();

    const swipes = await ctx.db
      .query("swipes")
      .withIndex("by_room_member", (q) => q.eq("roomId", room._id))
      .collect();

    // Unanimity is judged against the CURRENT roster: someone who left stops
    // being required (rooms.leave takes their swipes with them), and someone
    // who joins must still clear the cards the room has already passed.
    const yes = new Set(
      swipes.filter((s) => s.dir === "yes").map((s) => `${s.questId}:${s.memberId}`),
    );
    // Scanned in rank order, so if two cards become unanimous in the same
    // transaction the better-ranked one wins rather than an arbitrary one.
    const unanimous = quests.find(
      (q) => members.length > 0 && members.every((m) => yes.has(`${q._id}:${m._id}`)),
    );

    let winner: Id<"quests"> | null = unanimous?._id ?? null;

    if (!winner) {
      // Deck exhausted with no agreement -- declare the top-scored card rather
      // than deadlock. This is the safety net that makes a live demo safe.
      //
      // "Done" is computed exactly as rooms.get computes `waitingOn`, so the
      // room can never show nobody left to wait on while still refusing to
      // resolve. Note there is no `quests.length > 0` guard here: the empty
      // deck was already resolved above, and guarding on it there would have
      // made this branch unreachable for precisely the room that needs it.
      const everyoneDone = members.every(
        (m) => swipes.filter((s) => s.memberId === m._id).length >= quests.length,
      );
      if (everyoneDone) winner = topScored(quests)._id;
    }

    if (!winner) return { matched: false, questId: null };

    await ctx.db.patch(room._id, { status: "matched", matchedQuestId: winner });
    // The plan is built out of band: the match must land on every phone now,
    // not after an LLM round trip.
    await ctx.scheduler.runAfter(0, internal.plans.generate, {
      roomId: room._id,
      questId: winner,
    });
    return { matched: true, questId: winner };
  },
});
