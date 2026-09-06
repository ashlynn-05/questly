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

    const members = await ctx.db
      .query("members")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();

    // The plan is the night the group actually agreed to, so its per-head total
    // wins. The matched card's own price is the stand-in for the window between
    // the match and the plan landing.
    const perHead = plan?.totalPerHeadCents ?? quest.priceCents;
    const deepLink = quest.mapsUri ?? quest.websiteUri ?? mapsSearchUrl(quest.title);

    // The room code doubles as the reference -- one number to read aloud.
    const ref = `QL-${room.code}`;

    await ctx.db.insert("bookings", {
      roomId: room._id,
      questId: quest._id,
      ref,
      // The roster, not the host's lobby guess: the total has to be what the
      // people actually coming will pay between them.
      headcount: members.length,
      totalCents: perHead * members.length,
      status: "simulated",
      deepLink,
    });

    await ctx.db.patch(room._id, { status: "booked" });
    return { ref, deepLink };
  },
});
