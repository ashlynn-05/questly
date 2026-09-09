import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { notifyRoom } from "../push/notify";
import { enqueuePlanGeneration } from "../plans/queue";

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

/**
 * The ONE place a room's match is decided. Do not inline a second copy.
 *
 * It lives here, rather than inside `swipes.cast`, for the same reason
 * `applyStopSwap` lives in `lib/swap.ts`: more than one event can satisfy the
 * match conditions, and if each caller carried its own copy of the rule the
 * copies would drift.
 *
 * A match becomes possible when EITHER side of the comparison moves:
 *  - a swipe arrives (`swipes.cast`), or
 *  - the roster shrinks (`rooms.leave`, `rooms.removeMember`), because both
 *    conditions below are quantified over `members`.
 *
 * That second case is why this extraction is a bug fix and not a tidy-up.
 * Three people, two of whom swipe the whole deck, and the third leaves: the
 * deck is exhausted and every remaining member is done, so the room SHOULD
 * resolve -- but if resolution only ever ran inside `cast`, nothing would
 * evaluate it, there would be no cards left for anyone to swipe, and the room
 * would sit on "swiping" forever with an empty `waitingOn`. The Global
 * Constraint says the match can never deadlock, so every event that can make
 * the conditions true has to run them.
 *
 * Declaring twice is impossible by construction: a room already `matched` or
 * `booked` returns its existing winner untouched and schedules nothing. That
 * guard lives HERE rather than in the callers, so a caller cannot forget it.
 *
 * Returns the winning quest id, or null if the room did not resolve.
 *
 * `actor` is whoever's action reached this, and it exists ONLY so the match
 * notification skips their phone -- they are looking at the screen that just
 * declared it. It is a member row rather than a user id because every caller
 * already holds the row their `sessionKey` resolved to, so the exclusion is
 * derived from the capability that authorised the action. `null` means the
 * roster moved rather than somebody swiping (`rooms.leave`,
 * `rooms.removeMember`), and then everybody left is told.
 *
 * It changes nothing about WHETHER a room resolves. The rule below is still
 * the only copy of itself; this is an argument threaded past it, not a second
 * opinion about unanimity.
 */
export async function resolveMatch(
  ctx: MutationCtx,
  roomId: Id<"rooms">,
  actor: Doc<"members"> | null = null,
): Promise<Id<"quests"> | null> {
  const room = await ctx.db.get(roomId);
  if (!room) return null;

  // Already decided. A late swipe, or a member leaving a second after the
  // match landed, must not re-declare a winner or post a second plan build.
  if (room.status === "matched" || room.status === "booked") {
    return room.matchedQuestId ?? null;
  }

  // Nothing to resolve in a room that has not started swiping. Not an error
  // here: the callers decide whether their own situation deserves a throw.
  if (room.status !== "swiping") return null;

  const quests = await ctx.db
    .query("quests")
    .withIndex("by_room_rank", (q) => q.eq("roomId", roomId))
    .order("asc")
    .collect();

  // A swiping room with no cards is the one state that can neither match nor
  // exhaust, so it would wait forever -- and the match may never deadlock.
  // Hand it back to the lobby, where the host still has the build button: the
  // same recovery `deck.abandonBuild` performs for a build that found nothing.
  if (quests.length === 0) {
    await ctx.db.patch(roomId, { status: "lobby" });
    return null;
  }

  const members = await ctx.db
    .query("members")
    .withIndex("by_room", (q) => q.eq("roomId", roomId))
    .collect();

  // Read after the caller's own write, never passed in: this is what lets one
  // implementation serve a caller that just inserted a swipe and a caller that
  // just deleted a departing member's. Bounded by MAX_ROOM_MEMBERS x the deck
  // -- the same roster x deck read `rooms.get` already does on every update,
  // and the reason that cap exists.
  const swipes = await ctx.db
    .query("swipes")
    .withIndex("by_room_member", (q) => q.eq("roomId", roomId))
    .collect();

  // `members.swipeCount` is written HERE and nowhere else.
  //
  // This is the one place in the backend that holds the whole roster and every
  // swipe row in the same transaction, after the caller's own write -- which is
  // exactly what the count needs, so it costs no additional reads at all. Every
  // mutation that touches a swipe row reaches this function (`swipes.cast`
  // after its insert or patch, `detachMember` after its deletes), because the
  // never-deadlock rule already makes that mandatory. There is no path that
  // writes a swipe and skips it.
  //
  // Recomputed rather than adjusted by a delta, deliberately. A delta would be
  // a second copy of "how many cards has this person answered", living next to
  // the insert, and the copies drift the first time somebody adds a path that
  // writes a row -- an undo, a fixture, a repair. Recomputing means such a path
  // is repaired by the next mutation in the room rather than corrupting a
  // number the deck screen navigates by.
  //
  // The inequality guard is not a micro-optimisation. `swipes.cast` writes
  // NOTHING when a client re-sends an identical swipe, precisely so a retrying
  // phone cannot churn the row every other phone subscribes to. An
  // unconditional patch here would hand that churn straight back, and worse:
  // the `members` range is in all twelve subscribers' read sets. In steady
  // state this writes exactly one row per new swipe.
  for (const member of members) {
    const count = swipes.filter((s) => s.memberId === member._id).length;
    if (member.swipeCount !== count) {
      await ctx.db.patch(member._id, { swipeCount: count });
    }
  }

  // Unanimity is judged against the CURRENT roster: someone who left stops
  // being required (their swipes go with them), and someone who joins must
  // still clear the cards the room has already passed.
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
    // "Done" and `rooms.get`'s `waitingOn` can never disagree. That used to be
    // true because the two were the same expression written twice; it is now
    // true by construction, which is stronger. `rooms.get` displays
    // `swipeCount`, and the loop above wrote `swipeCount` from the very rows
    // this line judges, in this transaction. So the room cannot show nobody
    // left to wait on while still refusing to resolve.
    //
    // This deliberately counts the ROWS rather than reading the number it just
    // wrote. Asking a derived value what it was derived from is circular, and
    // this branch is not cosmetic like `waitingOn` is: it writes `matched`,
    // enqueues the plan build and pushes every phone in the room. An
    // irreversible transition is decided on ground truth, never on a cache.
    //
    // An empty roster cannot reach here: `members.length === 0` would
    // make this vacuously true, so it is excluded explicitly -- a room with
    // nobody in it has not agreed on anything.
    const everyoneDone =
      members.length > 0 &&
      members.every(
        (m) => swipes.filter((s) => s.memberId === m._id).length >= quests.length,
      );
    if (everyoneDone) winner = topScored(quests)._id;
  }

  if (!winner) return null;

  await ctx.db.patch(roomId, { status: "matched", matchedQuestId: winner });
  // The plan is built out of band: the match must land on every phone now, not
  // after an LLM round trip.
  await enqueuePlanGeneration(ctx, roomId, winner);
  // The payoff moment, and the one this whole feature is most for: everyone
  // who is not looking at the screen that just resolved.
  await notifyRoom(ctx, roomId, "matched", actor);
  return winner;
}
