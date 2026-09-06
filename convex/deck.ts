import { v, type Infer } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";

import schema from "./schema";
import {
  DECK_SIZE,
  FREE_TYPES,
  MOOD_TYPES,
  cosine,
  distanceKm,
  priceLevelToCents,
  scoreQuest,
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
  photoName: v.optional(v.string()),
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

/**
 * A build whose action is killed outright -- a deploy, a timeout, a crash --
 * never reaches its own error handler, so the room would keep its claim
 * forever. After this long, a claim is presumed dead and may be taken.
 */
const STALE_BUILD_MS = 2 * 60 * 1000;

/**
 * Take the room for one build, or refuse. Compare-and-set, because the check
 * and the write must be the same transaction: a host double-click puts two
 * actions here at once, and if both were allowed to proceed, the loser's
 * `insert` would later delete a deck the room was already swiping and orphan
 * every swipe cast against it.
 *
 * Returns a lease token on success and `null` on refusal. The token, not the
 * "building" status, is what later writes are checked against -- because a
 * stale claim can be taken while its build is still running, and that build
 * must not be able to overwrite whatever replaced it. It is a concurrency
 * discriminator, never a credential: `build` has already established that the
 * caller is the host before anything reaches here.
 */
export const markBuilding = internalMutation({
  args: { roomId: v.id("rooms") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { roomId }) => {
    const room = await ctx.db.get(roomId);
    if (!room) return null;

    if (room.status === "building") {
      // Someone else holds the claim. Take it only if it has gone stale.
      const startedAt = room.buildStartedAt ?? 0;
      if (Date.now() - startedAt < STALE_BUILD_MS) return null;
    } else if (room.status !== "lobby") {
      return null;
    }

    const buildToken = crypto.randomUUID();
    await ctx.db.patch(roomId, {
      status: "building",
      buildStartedAt: Date.now(),
      buildToken,
    });
    return buildToken;
  },
});

/** Whether this room is still held by this exact build. */
function holdsLease(room: Doc<"rooms"> | null, token: string): boolean {
  return room?.status === "building" && room.buildToken === token;
}

/**
 * A build that found nothing must not leave the room spinning on "building"
 * forever -- it goes back to the lobby, where the host still has the button.
 *
 * Token-checked like every other write: a build whose stale claim was taken
 * over must not hand back a room that now belongs to a build still in flight.
 */
export const abandonBuild = internalMutation({
  args: { roomId: v.id("rooms"), token: v.string() },
  returns: v.null(),
  handler: async (ctx, { roomId, token }) => {
    const room = await ctx.db.get(roomId);
    if (holdsLease(room, token)) {
      await ctx.db.patch(roomId, {
        status: "lobby",
        buildStartedAt: undefined,
        buildToken: undefined,
      });
    }
    return null;
  },
});

/**
 * Write the deck, if this build still holds the room.
 *
 * Returns the deck size, or `null` if the lease was taken while this build was
 * running. Bailing matters more than it looks: this deletes the room's whole
 * deck before writing, so a stalled build that wrote anyway would destroy the
 * deck that replaced it and orphan every swipe already cast against it.
 */
export const insert = internalMutation({
  args: { roomId: v.id("rooms"), token: v.string(), quests: v.array(questFields) },
  returns: v.union(v.number(), v.null()),
  handler: async (ctx, { roomId, token, quests }) => {
    if (!holdsLease(await ctx.db.get(roomId), token)) return null;

    const existing = await ctx.db
      .query("quests")
      .withIndex("by_room_rank", (q) => q.eq("roomId", roomId))
      .collect();
    for (const stale of existing) await ctx.db.delete(stale._id);

    for (const q of quests) await ctx.db.insert("quests", { ...q, roomId });
    await ctx.db.patch(roomId, {
      status: "swiping",
      deckBuiltAt: Date.now(),
      buildStartedAt: undefined,
      buildToken: undefined,
    });
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
  photoName?: string;
  mapsUri?: string;
  websiteUri?: string;
};

/** How many candidates survive to the embedding pass. */
const SHORTLIST_SIZE = 15;

/** Mean of the member taste vectors. Guests contribute nothing. */
function blend(vectors: number[][]): number[] | undefined {
  if (!vectors.length) return undefined;
  const width = vectors[0].length;
  // Divide by the vectors actually summed, not by every vector offered: a
  // profile written against an older embedding model has a different width and
  // is skipped, and dividing by the larger count would shrink the survivors
  // toward zero -- quietly weakening the taste term instead of ignoring one row.
  const usable = vectors.filter((vec) => vec.length === width);
  const out = new Array<number>(width).fill(0);
  for (const vec of usable) {
    for (let i = 0; i < width; i++) out[i] += vec[i] / usable.length;
  }
  return out;
}

/** Everything `scoreQuest` needs that is a property of the candidate. */
type Rankable = {
  priceCents: number;
  distanceKm: number;
  discountPct: number;
  partnerTier: number;
  moodMatch: boolean;
};

/**
 * The rest of `scoreQuest`'s input is a property of the ROOM doing the asking,
 * never of the candidate list. One closure per build, shared by the full path
 * and the cache path below, so a deck assembled from borrowed candidates cannot
 * be ranked by different maths than one assembled from a fresh Places call.
 */
const rankFor = (room: Doc<"rooms">) => (c: Rankable, tasteSimilarity: number) =>
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

type Ranked<T> = T & { score: number; breakdown: Record<string, number> };

/**
 * Rank a candidate list for one room, taste included, best first.
 *
 * The taste term is the product's differentiator -- the onboarding quiz exists
 * to fill it -- so it runs on every path that produces a deck, borrowed
 * candidates included. With no signed-in member carrying a vector the blend is
 * undefined, the term is a constant 0, and the embedding call is skipped.
 */
async function rankByTaste<T extends Rankable & { title: string; blurb: string }>(
  ctx: ActionCtx,
  candidates: T[],
  vectors: number[][],
  rank: (c: Rankable, tasteSimilarity: number) => { score: number; breakdown: Record<string, number> },
): Promise<Array<Ranked<T>>> {
  const byScore = (a: { score: number }, b: { score: number }) => b.score - a.score;
  const base: Array<Ranked<T>> = candidates.map((c) => ({ ...c, ...rank(c, 0) })).sort(byScore);

  // Guests contribute nothing, so the signed-in members' taste carries the
  // room. With none at all the ranking falls back to budget, distance, mood
  // and partner tier.
  const roomTaste = blend(vectors);
  if (!roomTaste) return base;

  try {
    const questVectors: number[][] = await ctx.runAction(internal.ai.embeddings.embedMany, {
      texts: base.map((c) => `${c.title}. ${c.blurb}`),
    });
    return base
      .map((c, i) => ({ ...c, ...rank(c, cosine(roomTaste, questVectors[i])) }))
      .sort(byScore);
  } catch (error) {
    // Ranking without taste is worse, not broken. Keep the untasted order --
    // but say so. A permanent OpenAI outage would otherwise degrade every
    // deck in the product forever, with nothing in the logs to explain why
    // the personalisation stopped working.
    console.warn("deck.build: taste re-rank skipped, ranking without it.", error);
    return base;
  }
}

/** One place, so a borrowed card can never label its price differently. */
const priceLabelFor = (cents: number) => (cents === 0 ? "Free" : `$${Math.round(cents / 100)}`);

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
  } catch (error) {
    // A missing key, a rate limit, a malformed body: none of it is worth
    // failing a deck over. Plainer cards beat no cards -- but a silent
    // fallback that never says so is a permanent outage nobody can see.
    console.warn("deck.build: no blurbs, falling back to the Places summary.", error);
    return empty;
  }
}

/**
 * Write the deck this build produced, or report that a newer build already
 * took the room's lease out from under it. Shared by the cache path and the
 * full build below so "the lease was lost" is reported identically either way.
 */
async function insertDeck(
  ctx: ActionCtx,
  roomId: Id<"rooms">,
  token: string,
  quests: Array<Infer<typeof questFields>>,
): Promise<number> {
  const deckSize: number | null = await ctx.runMutation(internal.deck.insert, { roomId, token, quests });
  if (deckSize === null) {
    // This build stalled long enough for its claim to be taken, and a newer
    // build has since finished. The room already has a deck -- a better one --
    // so this one goes in the bin rather than over the top of it.
    throwUserError(
      "BUILD_SUPERSEDED",
      "That took too long, so someone started the deck again. The newer one is ready.",
    );
  }
  return deckSize;
}

/** A borrowed candidate, carrying the two score inputs `quests` does not store. */
type CachedCandidate = Infer<typeof questFields> & {
  partnerTier: number;
  moodMatch: boolean;
};

/**
 * Turn a borrowed candidate list into THIS room's deck.
 *
 * What the cache holds is the expensive, room-independent half of a build: the
 * Places result set and the blurbs written over it. The other half -- the
 * ranking -- is not room-independent, so none of it is borrowed. Partner tier,
 * offer and distance are read back off this room's own live partner rows, and
 * `rankByTaste` runs this room's members' vectors over the borrowed titles.
 * Serving the donor's order instead would hand one group's personalisation to
 * another, which is precisely what the onboarding quiz exists to prevent.
 *
 * Returns fewer rows than it was given when a partner has since gone inactive
 * or dropped this mood: `deck.context` filters `venues` on `active === true`,
 * and a withdrawn offer must never reappear through the cache as a live
 * commercial claim.
 */
async function deckFromCache(
  ctx: ActionCtx,
  room: Doc<"rooms">,
  partners: Array<Doc<"venues">>,
  vectors: number[][],
  cached: Array<Infer<typeof questFields>>,
): Promise<Array<Infer<typeof questFields>>> {
  const partnerByPlaceId = new Map(partners.map((p) => [p.placeId, p]));

  const candidates: CachedCandidate[] = [];
  for (const q of cached) {
    if (q.source === "partner") {
      const venue = partnerByPlaceId.get(q.placeId);
      // Not on this room's active-partner list any more. Drop it rather than
      // show its offer, and drop it rather than silently restate it as a
      // non-partner card: the offer text IS the blurb, so there is nothing
      // honest left to say about it.
      if (!venue) continue;
      candidates.push({
        ...q,
        // The live row wins over the cached copy on every commercial field.
        title: venue.name,
        blurb: venue.offerText,
        priceCents: venue.priceFromCents,
        discountPct: venue.discountPct,
        photoUrl: venue.photoUrl,
        partnerTier: venue.partnerTier,
        distanceKm: distanceKm(room.centreLat, room.centreLng, venue.lat, venue.lng),
        // deck.context only returns partners carrying this room's mood.
        moodMatch: true,
      });
      continue;
    }
    candidates.push({
      ...q,
      partnerTier: 0,
      discountPct: 0,
      // `moodMatch` was never stored on its own, but the term it produced was:
      // `moodFit` is `moodMatch ? 1 : 0` times a fixed weight, and mood is part
      // of `cacheKey`, so a borrowed row's answer is this room's answer too.
      moodMatch: (q.scoreBreakdown.moodFit ?? 0) > 0,
      // A Places row keeps the `distanceKm` it was built with, and that is a
      // measurement rather than a guess: `cacheKey` matches centres exactly,
      // so the donor measured from the same point this room measures from.
      // The only loss is the 100m rounding applied when the row was stored --
      // the same rounding the card displays.
    });
  }

  const scored = (await rankByTaste(ctx, candidates, vectors, rankFor(room))).slice(0, DECK_SIZE);

  return scored.map((c, i) => ({
    rank: i,
    source: c.source,
    placeId: c.placeId,
    title: c.title,
    blurb: c.blurb,
    priceLabel: priceLabelFor(c.priceCents),
    priceCents: c.priceCents,
    distanceKm: Math.round(c.distanceKm * 10) / 10,
    discountPct: c.discountPct,
    photoUrl: c.photoUrl,
    photoName: c.photoName,
    mapsUri: c.mapsUri,
    websiteUri: c.websiteUri,
    score: c.score,
    scoreBreakdown: c.breakdown,
  }));
}

/**
 * The build itself, once the caller has been established as the host of a room
 * that is ready for one. Separated so `build` can put the room back in the
 * lobby if any of it fails.
 */
async function buildDeck(ctx: ActionCtx, roomId: Id<"rooms">, token: string): Promise<number> {
  const { room, partners, vectors } = await ctx.runQuery(internal.deck.context, { roomId });
  const rank = rankFor(room);

  // A room that recently asked the same question -- same mood, radius, budget
  // and centre, within the hour -- already paid for the two room-independent
  // halves of a build: the Places result set and the written blurbs. Borrow
  // those; do the ranking here, for this room. See `recentDeck` below.
  const cached = await ctx.runQuery(internal.deck.recentDeck, { roomId });
  if (cached) {
    const quests = await deckFromCache(ctx, room, partners, vectors, cached);
    // Empty only when every borrowed row was a partner offer since withdrawn.
    // Then there is nothing left to reuse and a full build is the right answer.
    if (quests.length > 0) return insertDeck(ctx, roomId, token, quests);
  }

  const free = room.budgetPerHeadCents === 0;
  const includedTypes = free ? FREE_TYPES : MOOD_TYPES[room.mood];

  const places = await ctx.runAction(internal.places.searchNearbyInternal, {
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
      // The opaque Google reference, never a media URL: a URL would carry our
      // API key to the browser and into the stored quest row.
      photoName: place.photoName ?? undefined,
      mapsUri: place.mapsUri ?? undefined,
      websiteUri: place.websiteUri ?? undefined,
    });
  }

  if (candidates.length === 0) {
    throwUserError(
      "NO_CANDIDATES",
      "We could not find anywhere near you for that mood. Try a wider radius, or a different mood.",
    );
  }

  // Two passes. The first ranks on the cheap signals and cuts to a shortlist,
  // so the embedding call costs 15 vectors rather than every Places result.
  const shortlist = candidates
    .map((c) => ({ ...c, ...rank(c, 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, SHORTLIST_SIZE);

  const scored = (await rankByTaste(ctx, shortlist, vectors, rank)).slice(0, DECK_SIZE);

  // One batched call writes all nine blurbs. Batched because nine sequential
  // calls is the difference between a loading state and an abandoned room --
  // and because this is the last latency before the swipe, where none is
  // allowed at all.
  const blurbs = await writeBlurbs(scored.map((c) => c.title), room.mood);

  return insertDeck(
    ctx,
    roomId,
    token,
    scored.map((c, i) => ({
      rank: i,
      source: c.source,
      placeId: c.placeId,
      title: c.title,
      // A partner's own offer text always wins -- it is the commercial claim.
      blurb: c.source === "partner" ? c.blurb : blurbs[i] || c.blurb,
      priceLabel: priceLabelFor(c.priceCents),
      priceCents: c.priceCents,
      distanceKm: Math.round(c.distanceKm * 10) / 10,
      discountPct: c.discountPct,
      photoUrl: c.photoUrl,
      photoName: c.photoName,
      mapsUri: c.mapsUri,
      websiteUri: c.websiteUri,
      score: c.score,
      scoreBreakdown: c.breakdown,
    })),
  );
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
    // The checks above are for the error message; THIS is the authorisation to
    // build. Everything before it was read in an earlier transaction and could
    // already be stale by now.
    const token = await ctx.runMutation(internal.deck.markBuilding, { roomId });
    if (token === null) {
      throwUserError("BUILD_IN_PROGRESS", "This deck is already being built. Give it a moment.");
    }

    try {
      return { deckSize: await buildDeck(ctx, roomId, token) };
    } catch (error) {
      // Google 5xx, a quota wall, an empty neighbourhood: whatever it was, the
      // room must not be left spinning on "building" with no way out of it.
      // Only if we still hold it -- abandonBuild checks the token.
      await ctx.runMutation(internal.deck.abandonBuild, { roomId, token });
      throw error;
    }
  },
});

/** A cached deck goes stale after this long, so a demo run from yesterday never
 * serves tonight's prices. An hour is generous for a live demo and short
 * enough that nobody could call the reused cards "the wrong deck". */
const DECK_TTL_MS = 60 * 60 * 1000;

/**
 * How far back the lookup reaches. The TTL already bounds the index range; this
 * bounds a busy hour, so one room's build can never read an unbounded number of
 * rows. A bucket that has fallen off the end of this window is a cache MISS --
 * a full build, which is slower and dearer but never a wrong answer.
 */
const CACHE_LOOKBACK = 50;

/**
 * What two rooms must share for one's candidate list to be usable by the other.
 *
 * Every component here determines the SEARCH, not the ranking: mood picks the
 * Places types queried and which partner venues are eligible; radius is the
 * search circle; a $0 budget swaps the type list for `FREE_TYPES` and zeroes
 * every Places price; and the centre is both the point that circle is drawn
 * around and the point every stored `distanceKm` was measured from.
 *
 * The centre is matched exactly, not rounded to two decimals. Rounding would
 * bucket two points up to ~1.4km apart into one key, and a borrowed
 * `distanceKm` -- printed on the card as "0.3 km" and read aloud by a screen
 * reader -- would then be the other room's distance to a real place, which is a
 * false claim rather than an approximation.
 *
 * Nothing here claims the two rooms would RANK those candidates alike, and the
 * cache no longer assumes it. `deckFromCache` re-scores every borrowed
 * candidate against this room's own partner rows, centre and members' taste
 * vectors. What is reused is only the network work -- one Places call and one
 * batch of blurb completions -- and both depend on the search alone, never on
 * who is asking.
 */
const cacheKey = (r: {
  mood: string;
  radiusKm: number;
  budgetPerHeadCents: number;
  centreLat: number;
  centreLng: number;
}) => [r.mood, r.radiusKm, r.budgetPerHeadCents, r.centreLat, r.centreLng].join("|");

/**
 * The candidate list a recent room with the same search already paid for, or
 * `null`. Places results for the same area and constraints do not meaningfully
 * change inside an hour, so re-querying spends money to be told the same nine
 * places -- and re-writing their blurbs spends more to be told the same
 * sentences about them.
 *
 * These rows are CANDIDATES, not a finished deck. The caller re-ranks them for
 * its own room; see `deckFromCache`. They come back stripped to exactly
 * `deck.insert`'s `quests` shape -- no `_id`, `_creationTime`, or the other
 * room's `roomId`.
 */
export const recentDeck = internalQuery({
  args: { roomId: v.id("rooms") },
  returns: v.union(v.null(), v.array(questFields)),
  handler: async (ctx, { roomId }) => {
    const room = await ctx.db.get(roomId);
    if (!room) return null;

    const cutoff = Date.now() - DECK_TTL_MS;
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
  },
});
