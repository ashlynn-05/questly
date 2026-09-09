import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { publicMutation } from "./lib/customFunctions";
import { refuseIfBooked, requireMember, roomByCode } from "./lib/rooms/access";
import { throwUserError } from "./lib/errors";
import { notifyRoom } from "./lib/push/notify";
import {
  DEFAULT_FINALIZE_RULE,
  clearFinalizeVotes,
  voteLapsed,
  votesNeeded,
} from "./lib/rooms/rules";

function mapsSearchUrl(name: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} Melbourne`)}`;
}

type Settled = { booked: boolean; ref: string | null; deepLink: string | null };

/**
 * Everything that happens once the room has actually agreed.
 *
 * Split out of `confirm` because there are now three ways to arrive here -- the
 * permissive default, the host's own tap, and the vote that reaches its
 * threshold -- and a booking written three slightly different ways is three
 * different products. The authorisation is entirely the caller's; this writes.
 */
async function writeBooking(
  ctx: MutationCtx,
  room: Doc<"rooms">,
  quest: Doc<"quests">,
  plan: Doc<"plans">,
  members: Doc<"members">[],
  actor: Doc<"members">,
): Promise<Settled> {
  // The plan is the night the group actually agreed to, so its per-head total
  // is the only number a booking may quote.
  const perHead = plan.totalPerHeadCents;
  const deepLink = quest.mapsUri ?? quest.websiteUri ?? mapsSearchUrl(quest.title);

  // The room code doubles as the reference -- one number to read aloud.
  const ref = `QL-${room.code}`;

  await ctx.db.insert("bookings", {
    roomId: room._id,
    questId: quest._id,
    ref,
    // The roster, not the host's lobby guess: the total has to be what the
    // people actually coming will pay between them.
    //
    // FROZEN, AND DELIBERATELY SO. `rooms.leave` has no booked-status guard
    // -- people genuinely cannot make things, and a product that traps you in
    // a night you cannot attend is a worse product -- so these two numbers
    // can stop describing the current roster the moment somebody drops out.
    // Nothing recomputes them when that happens, and nothing should: a
    // booking is a record of what the group agreed to, and "$37 each between
    // 3" is a figure nobody in that room has ever seen or consented to.
    //
    // The screen is what carries the difference. `Booked.tsx` reads "Going"
    // off the LIVE roster (`rooms.get` returns both), and when the two differ
    // it says what the night was split between as well. The ruling and the
    // options it was chosen over are written up in `src/lib/booking.ts`;
    // `bookings.test.ts` holds the invariant that this row does not move.
    headcount: members.length,
    totalCents: perHead * members.length,
    status: "simulated",
    deepLink,
  });

  // The vote is over, whichever way it was reached. The rows go so a room that
  // is somehow unbooked later cannot be settled again by a tally nobody
  // remembers casting, and `finalizeStartedAt` goes because its presence is
  // what every other path reads as "a vote is open".
  await clearFinalizeVotes(ctx, room._id);
  await ctx.db.patch(room._id, { status: "booked", finalizeStartedAt: undefined });

  // A booked room has nothing left to decide, so an open proposal must not
  // outlive the booking. Closed as "rejected" -- the status `settleProposal`
  // already uses for resolved-without-applying -- rather than left dangling.
  //
  // This is not tidiness. `detachMember` re-runs `resolveOpenProposals`
  // whenever the roster shrinks, and a smaller roster means a smaller
  // majority: an open proposal one vote short at booking time would PASS the
  // moment a non-voter left, rewriting the itinerary the group is already
  // holding a reference to. Closing them here removes what that path finds;
  // `detachMember` refusing to resolve in a booked room closes the path
  // itself. Both, because the next path someone adds will not know about this.
  const openProposals = await ctx.db
    .query("proposals")
    .withIndex("by_room_status", (q) => q.eq("roomId", room._id).eq("status", "open"))
    .collect();
  for (const proposal of openProposals) {
    await ctx.db.patch(proposal._id, { status: "rejected" });
  }

  // Everyone but whoever's tap settled it. Under a vote rule that is the last
  // person to say yes, and under "anyone" or "host" it is the one person who
  // decided -- either way it is the member row `confirm` authorised, threaded
  // in rather than re-derived, so this stays the single place a booking is
  // written and the caller stays the single place authorisation happens.
  await notifyRoom(ctx, room._id, "booked", actor);

  return { booked: true, ref, deepLink };
}

/**
 * Simulated. No table is held and no venue is contacted -- the UI says so in
 * plain words, and nothing here may imply otherwise.
 *
 * One entry point for four house rules, because the tap is the same tap: "I
 * want this night". What that tap MEANS is `room.finalizeRule`.
 *
 *  - "anyone"   -- it books, which is what this product has always done.
 *  - "host"     -- it books for the host, and is refused for everyone else.
 *  - "majority" -- it is a yes vote, and books on the strict majority.
 *  - "all"      -- it is a yes vote, and books when the last person votes.
 *
 * The counts a screen draws are NOT returned from here. `rooms.get` projects
 * them, every phone in the room is already subscribed to it, and a tally
 * returned only to the person who tapped is a tally the other phones would
 * have to be told about some other way.
 */
export const confirm = publicMutation({
  args: { code: v.string(), sessionKey: v.string() },
  returns: v.object({
    // False means the vote is recorded and the room is still short of its
    // threshold. It is the ordinary outcome under a vote rule, not a failure,
    // so it is a value and not a throw.
    booked: v.boolean(),
    ref: v.union(v.string(), v.null()),
    deepLink: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args): Promise<Settled> => {
    const room = await roomByCode(ctx, args.code);
    const member = await requireMember(ctx, room._id, args.sessionKey);

    // .first(), not .unique(), for the reason documented at length in rooms.get:
    // nothing in the schema enforces one booking per room, and .unique() throws
    // on a duplicate -- which would make booking permanently impossible for that
    // room rather than merely returning a stale reference.
    const existing = await ctx.db
      .query("bookings")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .first();
    // Two people tapping "book" at the same moment is the normal case, not the
    // edge case. The second tap reads back the first booking rather than
    // charging the group twice over.
    if (existing) return { booked: true, ref: existing.ref, deepLink: existing.deepLink };

    if (!room.matchedQuestId) {
      throwUserError("NOTHING_TO_BOOK", "There is nothing to book yet.");
    }
    const quest = await ctx.db.get(room.matchedQuestId);
    if (!quest) throwUserError("NOTHING_TO_BOOK", "There is nothing to book yet.");

    // .first(), not .unique(), for the same reason as the booking read above.
    const plan = await ctx.db
      .query("plans")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .first();

    // Booking is refused in the window between the match and the plan landing,
    // and that window is now closed rather than absorbed.
    //
    // It used to fall back to the matched card's own price. Two things were
    // wrong with that. The booking quoted a single venue's banded price for a
    // night the product describes as multi-stop -- and `plans.writePlan`
    // deliberately DROPS a plan that arrives after a booking, so the room ended
    // up booked, with a reference the group is holding, and no plan at all, for
    // good: no server path can produce one afterwards. Waiting a few seconds is
    // the whole cost of closing it, and `plans.retry` is there if the plan
    // never lands.
    //
    // Checked BEFORE any vote is recorded, so a room nobody could book anyway
    // never accumulates a tally that looks like consent.
    if (!plan) {
      throwUserError(
        "PLAN_NOT_READY",
        "The plan is still being written. Give it a moment, then book the night itself.",
      );
    }

    const members = await ctx.db
      .query("members")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();

    const rule = room.finalizeRule ?? DEFAULT_FINALIZE_RULE;

    if (rule === "anyone" || rule === "host") {
      // Read off the member row this session key resolved to, never off an
      // argument: a client-supplied `isHost` is not a fact about the room.
      if (rule === "host" && !member.isHost) {
        throwUserError(
          "NOT_THE_HOST",
          "The host settles this room. Ask them to book it when everyone is happy.",
        );
      }
      return await writeBooking(ctx, room, quest, plan, members, member);
    }

    const seconds = room.finalizeSeconds ?? 0;
    const now = Date.now();

    // A window that ran out counts for nothing, and this tap is the start of
    // the next one rather than the tail of the last. Nothing is scheduled to
    // fire at a deadline -- the question is decided here, where the answer is
    // needed, and the screen counts the identical window down from the same
    // `finalizeStartedAt`.
    const lapsed = voteLapsed(room.finalizeStartedAt, seconds, now);
    if (lapsed) await clearFinalizeVotes(ctx, room._id);
    if (lapsed || room.finalizeStartedAt === undefined) {
      await ctx.db.patch(room._id, { finalizeStartedAt: now });
    }

    // One row per member, so a double tap or a reconnect cannot supply somebody
    // else's missing yes. Voting twice is voting once.
    const mine = await ctx.db
      .query("finalizeVotes")
      .withIndex("by_room_member", (q) =>
        q.eq("roomId", room._id).eq("memberId", member._id),
      )
      .unique();
    if (!mine) {
      await ctx.db.insert("finalizeVotes", {
        roomId: room._id,
        memberId: member._id,
        at: now,
      });
    }

    const votes = await ctx.db
      .query("finalizeVotes")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();

    if (votes.length < votesNeeded(rule, members.length)) {
      return { booked: false, ref: null, deepLink: null };
    }

    return await writeBooking(ctx, room, quest, plan, members, member);
  },
});

/**
 * Take your yes back.
 *
 * The half of a vote that makes it a vote rather than a countdown to a booking
 * nobody can stop. Refused once the night is booked, for the same reason every
 * other path into a settled plan is: the group is holding a reference to it.
 */
export const retract = publicMutation({
  args: { code: v.string(), sessionKey: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const room = await roomByCode(ctx, args.code);
    // After requireMember, so a stranger is told they are a stranger rather
    // than being told about the state of a room they are not in.
    const member = await requireMember(ctx, room._id, args.sessionKey);
    refuseIfBooked(room);

    const mine = await ctx.db
      .query("finalizeVotes")
      .withIndex("by_room_member", (q) =>
        q.eq("roomId", room._id).eq("memberId", member._id),
      )
      .unique();
    // Retracting a vote you never cast is not an error. It is what a second tap
    // on a control that has already been pressed looks like.
    if (!mine) return null;
    await ctx.db.delete(mine._id);

    const left = await ctx.db
      .query("finalizeVotes")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();
    // The last person out closes the window, so the next yes starts a fresh
    // clock instead of inheriting the remains of an abandoned one.
    if (left.length === 0) {
      await ctx.db.patch(room._id, { finalizeStartedAt: undefined });
    }
    return null;
  },
});
