import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireMember, roomByCode } from "./lib/access";
import { throwUserError } from "./lib/errors";

function mapsSearchUrl(name: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} Melbourne`)}`;
}

/**
 * Simulated. No table is held and no venue is contacted -- the UI says so in
 * plain words, and nothing here may imply otherwise.
 */
export const confirm = mutation({
  args: { code: v.string(), sessionKey: v.string() },
  returns: v.object({ ref: v.string(), deepLink: v.string() }),
  handler: async (ctx, args): Promise<{ ref: string; deepLink: string }> => {
    const room = await roomByCode(ctx, args.code);
    // Any member can book. Whoever is holding their phone when the group agrees
    // should not have to hand it to the host.
    await requireMember(ctx, room._id, args.sessionKey);

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
    if (existing) return { ref: existing.ref, deepLink: existing.deepLink };

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

    await ctx.db.patch(room._id, { status: "booked" });

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

    return { ref, deepLink };
  },
});
