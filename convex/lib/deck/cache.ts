import { v, type Infer } from "convex/values";
import type { QueryCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";

export const questFields = v.object({
  rank: v.number(),
  source: v.union(v.literal("partner"), v.literal("places")),
  placeId: v.string(),
  title: v.string(),
  blurb: v.string(),
  priceLabel: v.string(),
  // `null` is "Google gave no price signal". See the schema comment.
  priceCents: v.union(v.number(), v.null()),
  distanceKm: v.number(),
  discountPct: v.number(),
  photoUrl: v.optional(v.string()),
  photoName: v.optional(v.string()),
  mapsUri: v.optional(v.string()),
  websiteUri: v.optional(v.string()),
  score: v.number(),
  scoreBreakdown: v.record(v.string(), v.number()),
});

const DECK_TTL_MS = 60 * 60 * 1000;
const CACHE_LOOKBACK = 50;

const cacheKey = (r: {
  mood: string;
  radiusKm: number;
  budgetPerHeadCents: number;
  centreLat: number;
  centreLng: number;
}) => [r.mood, r.radiusKm, r.budgetPerHeadCents, r.centreLat, r.centreLng].join("|");

export async function findRecentDeck(
  ctx: QueryCtx,
  roomId: Id<"rooms">,
  now: number,
): Promise<Array<Infer<typeof questFields>> | null> {

    const room = await ctx.db.get(roomId);
    if (!room) return null;

    const cutoff = now - DECK_TTL_MS;
    // Newest first, and bounded twice: the index range drops everything built
    // before the TTL, and `take` caps the rest. Freshest wins -- handing a room
    // the oldest deck still inside the window would put it minutes from expiry
    // when a far newer one was sitting right there.
    const recent = await ctx.db
      .query("rooms")
      .withIndex("by_deckBuiltAt", (q) => q.gte("deckBuiltAt", cutoff))
      .order("desc")
      .take(CACHE_LOOKBACK);

    const key = cacheKey(room);
    for (const other of recent) {
      if (other._id === roomId) continue;
      if (cacheKey(other) !== key) continue;

      const quests = await ctx.db
        .query("quests")
        .withIndex("by_room_rank", (q) => q.eq("roomId", other._id))
        .order("asc")
        .collect();
      if (quests.length === 0) continue;

      // Named field-by-field, not `{ _id, _creationTime, roomId, ...rest }`:
      // that destructure names three bindings only to throw them away, which
      // is an unused-vars warning on every one of them. Insert re-adds
      // `roomId` for the new room; the other two are system fields `insert`
      // never accepted in the first place.
      return quests.map((q) => ({
        rank: q.rank,
        source: q.source,
        placeId: q.placeId,
        title: q.title,
        blurb: q.blurb,
        priceLabel: q.priceLabel,
        priceCents: q.priceCents,
        distanceKm: q.distanceKm,
        discountPct: q.discountPct,
        photoUrl: q.photoUrl,
        photoName: q.photoName,
        mapsUri: q.mapsUri,
        websiteUri: q.websiteUri,
        score: q.score,
        scoreBreakdown: q.scoreBreakdown,
      }));
    }
    return null;
}
