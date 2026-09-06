import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  DECK_SIZE,
  FREE_TYPES,
  MOOD_TYPES,
  cosine,
  distanceKm,
  priceLevelToCents,
  scoreQuest,
  type Mood,
} from "./lib/scoring";
import { throwUserError } from "./lib/errors";
import { jsonCompletion } from "./lib/openai";

const questFields = v.object({
  rank: v.number(),
  source: v.union(v.literal("partner"), v.literal("places")),
  placeId: v.string(),
  title: v.string(),
  blurb: v.string(),
  priceLabel: v.string(),
  priceCents: v.number(),
  distanceKm: v.number(),
  discountPct: v.number(),
  photoUrl: v.optional(v.string()),
  mapsUri: v.optional(v.string()),
  websiteUri: v.optional(v.string()),
  score: v.number(),
  scoreBreakdown: v.record(v.string(), v.number()),
});

export const context = internalQuery({
  args: { roomId: v.id("rooms") },
  returns: v.object({
    room: schema.doc("rooms"),
    partners: v.array(schema.doc("venues")),
    vectors: v.array(v.array(v.float64())),
  }),
  handler: async (ctx, { roomId }) => {
    const room = await ctx.db.get(roomId);
    if (!room) throwUserError("ROOM_NOT_FOUND", "That room is gone.");

    const partners = (
      await ctx.db.query("venues").withIndex("by_active", (q) => q.eq("active", true)).collect()
    ).filter((venue) => venue.moods.includes(room.mood));

    const members = await ctx.db
      .query("members")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .collect();

    // Guests have no profile, so the signed-in members' taste carries the room.
    const vectors: number[][] = [];
    for (const member of members) {
      if (!member.userId) continue;
      const userId = member.userId;
      const profile = await ctx.db
        .query("profiles")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique();
      if (profile?.tasteVector.length) vectors.push(profile.tasteVector);
    }

    return { room, partners, vectors };
  },
});

export const markBuilding = internalMutation({
  args: { roomId: v.id("rooms") },
  returns: v.null(),
  handler: async (ctx, { roomId }) => {
    await ctx.db.patch(roomId, { status: "building" });
    return null;
  },
});

/**
 * A build that found nothing must not leave the room spinning on "building"
 * forever -- it goes back to the lobby, where the host still has the button.
 */
export const abandonBuild = internalMutation({
  args: { roomId: v.id("rooms") },
  returns: v.null(),
  handler: async (ctx, { roomId }) => {
    const room = await ctx.db.get(roomId);
    if (room?.status === "building") await ctx.db.patch(roomId, { status: "lobby" });
    return null;
  },
});

export const insert = internalMutation({
  args: { roomId: v.id("rooms"), quests: v.array(questFields) },
  returns: v.number(),
  handler: async (ctx, { roomId, quests }) => {
    const existing = await ctx.db
      .query("quests")
      .withIndex("by_room_rank", (q) => q.eq("roomId", roomId))
      .collect();
    for (const stale of existing) await ctx.db.delete(stale._id);

    for (const q of quests) await ctx.db.insert("quests", { ...q, roomId });
    await ctx.db.patch(roomId, { status: "swiping", deckBuiltAt: Date.now() });
    return quests.length;
  },
});

type Candidate = {
  source: "partner" | "places";
  placeId: string;
  title: string;
  blurb: string;
  priceCents: number;
  distanceKm: number;
  discountPct: number;
  partnerTier: number;
  /** Whether this candidate is actually the kind of place the mood asked for. */
  moodMatch: boolean;
  photoUrl?: string;
  mapsUri?: string;
  websiteUri?: string;
};

/** How many candidates survive to the embedding pass. */
const SHORTLIST_SIZE = 15;

/** Mean of the member taste vectors. Guests contribute nothing. */
function blend(vectors: number[][]): number[] | undefined {
  if (!vectors.length) return undefined;
  const width = vectors[0].length;
  const out = new Array<number>(width).fill(0);
  for (const vec of vectors) {
    if (vec.length !== width) continue;
    for (let i = 0; i < width; i++) out[i] += vec[i] / vectors.length;
  }
  return out;
}

/**
 * One call, all nine blurbs. Returns an array aligned to `titles`, with an
 * empty string wherever the model gave nothing -- the caller falls back to the
 * Places summary, so a missing blurb is a plainer card, never a broken one.
 */
async function writeBlurbs(titles: string[], mood: string): Promise<string[]> {
  const empty = titles.map(() => "");
  if (titles.length === 0) return empty;

  try {
    const raw = (await jsonCompletion(
      [
        `These Melbourne places are options for a "${mood}" night out:`,
        titles.map((t, i) => `${i}. ${t}`).join("\n"),
        "Write one short line for each -- what it is actually like, the way a",
        "friend would say it. No adjectives stacked up, no marketing.",
        'Return JSON only: {"blurbs":[{"i":number,"text":string}]}',
      ].join("\n"),
    )) as { blurbs?: Array<{ i?: unknown; text?: unknown }> };

    const out = [...empty];
    for (const entry of raw?.blurbs ?? []) {
      if (typeof entry.i === "number" && typeof entry.text === "string" && out[entry.i] !== undefined) {
        out[entry.i] = entry.text.trim();
      }
    }
    return out;
  } catch {
    // A missing key, a rate limit, a malformed body: none of it is worth
    // failing a deck over. Plainer cards beat no cards.
    return empty;
  }
}

export const build = action({
  args: { code: v.string(), sessionKey: v.string() },
  returns: v.object({ deckSize: v.number() }),
  handler: async (ctx, args): Promise<{ deckSize: number }> => {
    const view = await ctx.runQuery(api.rooms.get, {
      code: args.code,
      sessionKey: args.sessionKey,
    });
    if (!view) throwUserError("NOT_A_MEMBER", "You are not a member of this room.");

    // Host only. The lobby offers this button to nobody else, and two members
    // racing the build would each spend Places and OpenAI quota on a deck only
    // one of them gets to keep.
    if (!view.you.isHost) {
      throwUserError("NOT_THE_HOST", "Only the host can start the deck.");
    }
    // "building" is allowed so a build that died halfway can be retried. Past
    // that, a rebuild would silently invalidate swipes, a match, or a booking.
    if (view.room.status !== "lobby" && view.room.status !== "building") {
      throwUserError("ROOM_WRONG_STATE", "This room has already started swiping.");
    }

    const roomId: Id<"rooms"> = view.room._id;
    await ctx.runMutation(internal.deck.markBuilding, { roomId });

    const { room, partners, vectors } = await ctx.runQuery(internal.deck.context, { roomId });
    const free = room.budgetPerHeadCents === 0;
    const includedTypes = free ? FREE_TYPES : MOOD_TYPES[room.mood as Mood];

    const places = await ctx.runAction(api.places.searchNearby, {
      lat: room.centreLat,
      lng: room.centreLng,
      radiusKm: room.radiusKm,
      includedTypes,
      maxResults: 20,
    });

    // Partners first, and injected whether or not Places returned them -- that
    // injection is the inventory the business model is built on.
    const candidates: Candidate[] = partners.map((p) => ({
      source: "partner" as const,
      placeId: p.placeId,
      title: p.name,
      blurb: p.offerText,
      priceCents: p.priceFromCents,
      distanceKm: distanceKm(room.centreLat, room.centreLng, p.lat, p.lng),
      discountPct: p.discountPct,
      partnerTier: p.partnerTier,
      // deck.context only returns partners carrying this room's mood.
      moodMatch: true,
      photoUrl: p.photoUrl,
    }));

    const partnerIds = new Set(partners.map((p) => p.placeId));
    for (const place of places.results) {
      if (partnerIds.has(place.id)) continue; // never show a partner twice
      if (place.lat === null || place.lng === null) continue;
      candidates.push({
        source: "places",
        placeId: place.id,
        title: place.name,
        blurb: place.summary ?? place.type ?? "",
        priceCents: free ? 0 : priceLevelToCents(place.priceLevel),
        distanceKm: distanceKm(room.centreLat, room.centreLng, place.lat, place.lng),
        discountPct: 0,
        partnerTier: 0,
        // Places returns anything whose *types* include one we asked for, so a
        // coffee shop surfaces under a "restaurant" query. Matching the place's
        // own primaryType against the mood's list is what separates a real hit
        // from a near-miss -- and it is the only thing that keeps moodFit, one
        // of six weighted terms, from being a constant across the whole deck.
        moodMatch: place.primaryType !== null && includedTypes.includes(place.primaryType),
        photoUrl: place.photoUrl ?? undefined,
        mapsUri: place.mapsUri ?? undefined,
        websiteUri: place.websiteUri ?? undefined,
      });
    }

    if (candidates.length === 0) {
      await ctx.runMutation(internal.deck.abandonBuild, { roomId });
      throwUserError(
        "NO_CANDIDATES",
        "We could not find anywhere near you for that mood. Try a wider radius, or a different mood.",
      );
    }

    // Two passes. The first ranks on the cheap signals and cuts to a shortlist,
    // so the embedding call costs 15 vectors rather than every Places result.
    const rank = (c: Candidate, tasteSimilarity: number) =>
      scoreQuest({
        priceCents: c.priceCents,
        budgetPerHeadCents: room.budgetPerHeadCents,
        distanceKm: c.distanceKm,
        radiusKm: room.radiusKm,
        discountPct: c.discountPct,
        partnerTier: c.partnerTier,
        moodMatch: c.moodMatch,
        tasteSimilarity,
      });

    const shortlist = candidates
      .map((c) => ({ ...c, ...rank(c, 0) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, SHORTLIST_SIZE);

    // Taste. The room's vector is the mean of its signed-in members' vectors;
    // guests contribute nothing, so the host's carries. With no vectors at all
    // the term is 0 and the ranking falls back to budget, distance and partner.
    const roomTaste = blend(vectors);
    let scored = shortlist;

    if (roomTaste) {
      try {
        const questVectors: number[][] = await ctx.runAction(
          internal.ai.embeddings.embedMany,
          { texts: shortlist.map((c) => `${c.title}. ${c.blurb}`) },
        );
        scored = shortlist
          .map((c, i) => ({ ...c, ...rank(c, cosine(roomTaste, questVectors[i])) }))
          .sort((a, b) => b.score - a.score);
      } catch {
        // Ranking without taste is worse, not broken. Keep the shortlist order.
      }
    }

    scored = scored.slice(0, DECK_SIZE);

    // One batched call writes all nine blurbs. Batched because nine sequential
    // calls is the difference between a loading state and an abandoned room --
    // and because this is the last latency before the swipe, where none is
    // allowed at all.
    const blurbs = await writeBlurbs(scored.map((c) => c.title), room.mood);

    const deckSize: number = await ctx.runMutation(internal.deck.insert, {
      roomId,
      quests: scored.map((c, i) => ({
        rank: i,
        source: c.source,
        placeId: c.placeId,
        title: c.title,
        // A partner's own offer text always wins -- it is the commercial claim.
        blurb: c.source === "partner" ? c.blurb : blurbs[i] || c.blurb,
        priceLabel: c.priceCents === 0 ? "Free" : `$${Math.round(c.priceCents / 100)}`,
        priceCents: c.priceCents,
        distanceKm: Math.round(c.distanceKm * 10) / 10,
        discountPct: c.discountPct,
        photoUrl: c.photoUrl,
        mapsUri: c.mapsUri,
        websiteUri: c.websiteUri,
        score: c.score,
        scoreBreakdown: c.breakdown,
      })),
    });

    return { deckSize };
  },
});
