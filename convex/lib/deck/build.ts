import { type Infer } from "convex/values";
import { internal } from "../../_generated/api";
import type { ActionCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { questFields } from "./cache";
import {
  VENUE_CATALOG_CEILING,
  VENUE_PAGE_MAX_ROWS,
  VENUE_PAGE_MAX_BYTES,
  VENUE_PAGE_SIZE,
} from "./venues";
import {
  DECK_SIZE,
  FREE_TYPES,
  MOOD_TYPES,
  cosine,
  distanceKm,
  priceLevelToCents,
  scoreQuest,
} from "../scoring";
import { isProviderReservationError, throwUserError } from "../errors";
import { jsonCompletion } from "../openai";

type Candidate = {
  source: "partner" | "places";
  placeId: string;
  title: string;
  blurb: string;
  /** `null` when Google gave no price signal. Partners always carry a real one. */
  priceCents: number | null;
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
  priceCents: number | null;
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
const rankFor =
  (room: Doc<"rooms">, moodAffinity: number) => (c: Rankable, tasteSimilarity: number) =>
    scoreQuest({
      priceCents: c.priceCents,
      budgetPerHeadCents: room.budgetPerHeadCents,
      distanceKm: c.distanceKm,
      radiusKm: room.radiusKm,
      discountPct: c.discountPct,
      partnerTier: c.partnerTier,
      moodMatch: c.moodMatch,
      moodAffinity,
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
    if (isProviderReservationError(error)) throw error;
    // Ranking without taste is worse, not broken. Keep the untasted order --
    // but say so. A permanent OpenAI outage would otherwise degrade every
    // deck in the product forever, with nothing in the logs to explain why
    // the personalisation stopped working.
    console.warn("deck.build: taste re-rank skipped, ranking without it.", error);
    return base;
  }
}

/**
 * One place, so a borrowed card can never label its price differently.
 *
 * "Price unknown" is a real answer, not a formatting failure: Google has no
 * price signal for most parks, gardens and trails, and the card has to say that
 * rather than print a band nobody quoted. The screen wraps whatever comes back
 * in its own "Est. each" framing (`src/app/room/[code]/Deck.tsx`).
 */
const priceLabelFor = (cents: number | null) =>
  cents === null ? "Price unknown" : cents === 0 ? "Free" : `$${Math.round(cents / 100)}`;

/**
 * One call, all nine blurbs. Returns an array aligned to `titles`, with an
 * empty string wherever the model gave nothing -- the caller falls back to the
 * Places summary, so a missing blurb is a plainer card, never a broken one.
 */
async function writeBlurbs(ctx: ActionCtx, titles: string[], mood: string): Promise<string[]> {
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
      () => ctx.runMutation(internal.rateLimits.reserveProvider, { provider: "openai" }),
    )) as { blurbs?: Array<{ i?: unknown; text?: unknown }> };

    const out = [...empty];
    for (const entry of raw?.blurbs ?? []) {
      if (typeof entry.i === "number" && typeof entry.text === "string" && out[entry.i] !== undefined) {
        out[entry.i] = entry.text.trim();
      }
    }
    return out;
  } catch (error) {
    if (isProviderReservationError(error)) throw error;
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

type ActiveVenuePage = {
  page: Array<Doc<"venues">>;
  isDone: boolean;
  continueCursor: string;
  splitCursor?: string | null;
  pageStatus?: "SplitRecommended" | "SplitRequired" | null;
};

async function loadActiveVenues(
  ctx: ActionCtx,
  mood: Doc<"rooms">["mood"],
): Promise<Array<Doc<"venues">>> {
  const partners: Array<Doc<"venues">> = [];
  let activeCount = 0;
  let cursor: string | null = null;

  while (true) {
    const page: ActiveVenuePage = await ctx.runQuery(internal.deck.activeVenuePage, {
      paginationOpts: {
        numItems: VENUE_PAGE_SIZE,
        cursor,
        maximumRowsRead: VENUE_PAGE_MAX_ROWS,
        maximumBytesRead: VENUE_PAGE_MAX_BYTES,
      },
    });
    // A required split means Convex could not prove this page complete. The
    // action-side reader has a fixed page budget and no reactive pagination
    // state in which to replay the two split ranges, so accepting this page
    // would rank a silently truncated prefix. Fail before accumulating or
    // calling a provider; oversized rows are outside the supported catalog.
    if (page.pageStatus === "SplitRequired") {
      throwUserError(
        "VENUE_CATALOG_TOO_LARGE",
        "The active venue catalogue is too large to build this deck safely.",
      );
    }
    activeCount += page.page.length;
    if (activeCount > VENUE_CATALOG_CEILING) {
      throwUserError(
        "VENUE_CATALOG_TOO_LARGE",
        "The active venue catalogue is too large to build this deck safely.",
      );
    }
    for (const venue of page.page) {
      if (venue.moods.includes(mood)) partners.push(venue);
    }
    if (page.isDone) return partners;
    cursor = page.continueCursor;
  }
}

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
  moodAffinity: number,
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

  const scored = (await rankByTaste(ctx, candidates, vectors, rankFor(room, moodAffinity))).slice(
    0,
    DECK_SIZE,
  );

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
export async function buildDeck(ctx: ActionCtx, roomId: Id<"rooms">, token: string): Promise<number> {
  const { room, vectors, moodAffinity } = await ctx.runQuery(internal.deck.contextBase, {
    roomId,
  });
  const partners = await loadActiveVenues(ctx, room.mood);
  const rank = rankFor(room, moodAffinity);

  // A room that recently asked the same question -- same mood, radius, budget
  // and centre, within the hour -- already paid for the two room-independent
  // halves of a build: the Places result set and the written blurbs. Borrow
  // those; do the ranking here, for this room. See `recentDeck` below.
  const cached = await ctx.runQuery(internal.deck.recentDeck, { roomId, now: Date.now() });
  if (cached) {
    const quests = await deckFromCache(ctx, room, partners, vectors, moodAffinity, cached);
    // The cache path drops borrowed partner rows whose venue has since gone
    // inactive or dropped this mood, so a hit can come back much thinner than
    // it went in: eight withdrawn offers out of nine leaves a "personalised
    // deck" of one card, which the room matches or exhausts on the instant it
    // opens. That reads as a broken build rather than a fast one.
    //
    // The floor is deliberately relative to what was BORROWED rather than to
    // DECK_SIZE. A donor that only ever had two cards is a thin neighbourhood,
    // not an attrition problem -- a full rebuild there would spend a Places
    // call and a batch of blurbs to be handed the same two places. What is
    // worth rejecting is heavy LOSS, and that is what this measures.
    if (quests.length >= Math.ceil(cached.length / 2)) {
      return insertDeck(ctx, roomId, token, quests);
    }
    console.warn(
      `deck.build: room ${room.code}: only ${quests.length} of ${cached.length} borrowed cards ` +
        `survived this room's live partner list; building from scratch instead.`,
    );
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

    const banded = priceLevelToCents(place.priceLevel);
    // Whether this place is genuinely free, as opposed to merely unpriced.
    // Google says so outright with PRICE_LEVEL_FREE; failing that, a place with
    // no price signal AT ALL whose own primary type is one of the free
    // categories (a park, a beach) is free by the nature of the category.
    const genuinelyFree =
      banded === 0 ||
      (banded === null && place.primaryType !== null && FREE_TYPES.includes(place.primaryType));

    // HONESTY -- in a $0 room this is a FILTER, never an overwrite. It used to
    // stamp `0` on every Places result because the room had said $0, so a group
    // with nothing to spend was shown Eureka Skydeck labelled "Free" and would
    // have found out at the door. A room that can spend nothing is shown only
    // places that genuinely cost nothing; the alternative is not a cheaper
    // night, it is a wrong one.
    if (free && !genuinelyFree) continue;

    candidates.push({
      source: "places",
      placeId: place.id,
      title: place.name,
      blurb: place.summary ?? place.type ?? "",
      // A free-by-category place with no band is 0 -- that is a claim about the
      // category, which we can stand behind. Everything else keeps whatever
      // Google actually said, `null` included.
      priceCents: genuinelyFree ? 0 : banded,
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
  const blurbs = await writeBlurbs(ctx, scored.map((c) => c.title), room.mood);

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
