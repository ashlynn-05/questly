/**
 * Ranking maths. Deliberately free of Convex imports so it can be unit-tested
 * directly and reasoned about on its own.
 */

export type Mood = "grass" | "sidequest" | "hangout";

/**
 * The three activities, in the order the screen offers them.
 *
 * There were four, and two of them -- `meet` and `treat` -- described who you
 * were with rather than what you were doing, which is now its own question one
 * screen later. What is left is three things you can actually go and do.
 */
export const MOOD_IDS: readonly Mood[] = ["grass", "sidequest", "hangout"];

/** Everything a stored row may hold: the three above, plus the four it replaced. */
export type StoredMood = Mood | "meet" | "treat" | "new";

const RETIRED: Record<"meet" | "treat" | "new", Mood> = {
  // Both were kinds of company, and a room full of company is a hang-out.
  meet: "hangout",
  treat: "hangout",
  // "Do something new" is the same idea as a sidequest, with less personality.
  new: "sidequest",
};

/**
 * A stored mood as one of the three the product now speaks.
 *
 * Every room and venue written before the taxonomy changed carries one of the
 * retired ids, and `migrations.backfillMoods` rewrites them -- but a backfill
 * takes time to run and the screens cannot be wrong while it does. So the
 * translation lives at every read, and the backfill's job is to make this
 * function a no-op rather than to make it unnecessary.
 *
 * DELETE THIS, and `storedMoodValidator` with it, once the backfill has run
 * against every deployment. Nothing else keeps the retired ids alive.
 */
export function normalizeMood(stored: StoredMood): Mood {
  return stored in RETIRED ? RETIRED[stored as keyof typeof RETIRED] : (stored as Mood);
}

/**
 * Cards in a room's deck. Long enough that a unanimous match feels earned,
 * short enough that a group can exhaust it in one sitting.
 *
 * It lives here rather than in `convex/deck.ts` because a Convex function file
 * may only export Convex functions, and because it is a deck/ranking constant
 * like everything else in this module.
 */
export const DECK_SIZE = 9;

/** Mood drives the Places query. It is a filter, not a theme. */
export const MOOD_TYPES: Record<Mood, string[]> = {
  grass: ["park", "hiking_area", "beach", "garden"],
  sidequest: ["amusement_park", "tourist_attraction", "museum", "art_gallery", "bowling_alley"],
  hangout: ["bar", "cafe", "restaurant", "night_club", "bakery"],
};

/**
 * Types that are genuinely free to walk into, for a $0 budget.
 *
 * `tourist_attraction` is deliberately NOT here, though Google groups it with
 * these: Eureka Skydeck, SEA LIFE and ArtVo are all `tourist_attraction` and all
 * charge at the door. Listing it here priced them at $0 and printed "Free" on
 * the card for a group who had said they had nothing to spend. A type earns a
 * place on this list only if the whole category is free to enter.
 */
export const FREE_TYPES = ["park", "hiking_area", "beach", "garden"];

const PRICE_BANDS: Record<string, number> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1500,
  PRICE_LEVEL_MODERATE: 3500,
  PRICE_LEVEL_EXPENSIVE: 7000,
  PRICE_LEVEL_VERY_EXPENSIVE: 12000,
};

/**
 * Places gives a band, never a real price. Partner venues carry a real price
 * and skip this entirely.
 *
 * HONESTY -- `null` means "Google told us nothing about the price", and that is
 * NOT the same as any number. This used to default to `PRICE_LEVEL_MODERATE`,
 * so every venue Google has no price signal for -- which is most parks, gardens,
 * beaches and trails, i.e. the entire `grass` mood -- was stamped at $35 a head,
 * displayed as "$35", and quoted at $35 x the roster if the room booked it. A
 * venue with no price signal has no price. It does not have a default one.
 *
 * `0` is equally wrong as a default in the other direction: it would rank an
 * unpriced restaurant above every genuinely affordable option and print "Free"
 * on it. So the absence travels all the way to the card, which says so, and to
 * `scoreQuest`, which scores it neutrally. See `ScoreInput.priceCents`.
 */
export function priceLevelToCents(level: string | null | undefined): number | null {
  if (level && level in PRICE_BANDS) return PRICE_BANDS[level];
  return null;
}

/** Haversine, in kilometres. */
export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type ScoreInput = {
  /** `null` when Google gave no price signal. See `priceLevelToCents`. */
  priceCents: number | null;
  budgetPerHeadCents: number;
  distanceKm: number;
  radiusKm: number;
  discountPct: number;
  /** 0 = not a partner. Higher tiers rank higher. This is the revenue lever. */
  partnerTier: number;
  moodMatch: boolean;
  /**
   * How much this room's members actually want tonight's mood, blended from
   * their quiz answers. 0 for a room of guests, which is neutral -- see
   * `moodAffinityMultiplier`.
   */
  moodAffinity: number;
  /** Cosine similarity against the room's blended taste vector, -1..1. */
  tasteSimilarity: number;
};

/**
 * The quiz's mood answers, turned into a multiplier on `moodFit`.
 *
 * `lib/quiz.ts` scores each mood by counting the cards a person said "more" to
 * and subtracting the ones they said "less" to, so a single person's answer for
 * one mood lands in roughly -2..+2. Blended across the room's members with a
 * profile, that becomes this number.
 *
 * It scales the mood term rather than adding a term of its own, because it is
 * a statement about the SAME thing `moodFit` measures -- how well a card suits
 * the night the room chose -- and adding it separately would let a card that
 * matches nothing outrank one that does, purely because the room likes the mood.
 *
 * Deliberately gentle (0.5x to 1.5x on a weight of 1.2, so at most +/-0.6 on a
 * score whose other terms span about 6): personalisation should break ties
 * between comparable places, never bury a closer, cheaper, better-matched one.
 * And a room of guests, who have answered no quiz, scores exactly as before --
 * 0 maps to 1.0 -- so the absence of a profile costs nobody anything.
 */
export const MAX_MOOD_AFFINITY = 2;
export const MOOD_AFFINITY_SWING = 0.5;

export function moodAffinityMultiplier(affinity: number): number {
  const clamped = Math.max(-MAX_MOOD_AFFINITY, Math.min(MAX_MOOD_AFFINITY, affinity));
  return 1 + (clamped / MAX_MOOD_AFFINITY) * MOOD_AFFINITY_SWING;
}

const W = {
  partnerBoost: 1.4,
  discountFit: 0.8,
  distanceDecay: 1.0,
  budgetFit: 1.6,
  moodFit: 1.2,
  tasteSimilarity: 1.1,
};

export function scoreQuest(input: ScoreInput): {
  score: number;
  breakdown: Record<string, number>;
} {
  // Budget. Under budget is good; over budget is punished hard enough that a
  // cheap mediocre option always beats an unaffordable great one.
  let budgetFit: number;
  if (input.priceCents === null) {
    // No price signal at all. Neutral -- neither rewarded nor punished -- and
    // that is the only honest weight available: scoring an unknown price as $0
    // would float it above every genuinely affordable option on a fact we do
    // not have, and scoring it at a made-up band would bury an actually-free
    // park underneath a bar we do know the price of. Zero leaves the card to be
    // ranked on distance, mood and taste, which we DO know, and the card itself
    // says the price is unknown so the group decides with the same information
    // the ranker had.
    budgetFit = 0;
  } else if (input.budgetPerHeadCents === 0) {
    budgetFit = input.priceCents === 0 ? 1 : -2;
  } else if (input.priceCents <= input.budgetPerHeadCents) {
    budgetFit = 1 - (input.priceCents / input.budgetPerHeadCents) * 0.35;
  } else {
    const overBy = (input.priceCents - input.budgetPerHeadCents) / input.budgetPerHeadCents;
    budgetFit = -Math.min(2, overBy * 2);
  }

  const distanceDecay = Math.max(0, 1 - input.distanceKm / Math.max(input.radiusKm, 0.1));
  const discountFit = Math.min(1, input.discountPct / 40);
  const partnerBoost = Math.min(1, input.partnerTier / 3);
  // A card that does not match the mood scores 0 here however much the room
  // likes the mood -- affinity scales a match, it cannot manufacture one.
  const moodFit = input.moodMatch ? moodAffinityMultiplier(input.moodAffinity) : 0;
  const tasteSimilarity = Math.max(-1, Math.min(1, input.tasteSimilarity));

  const breakdown = {
    partnerBoost: partnerBoost * W.partnerBoost,
    discountFit: discountFit * W.discountFit,
    distanceDecay: distanceDecay * W.distanceDecay,
    budgetFit: budgetFit * W.budgetFit,
    moodFit: moodFit * W.moodFit,
    tasteSimilarity: tasteSimilarity * W.tasteSimilarity,
  };

  return { score: Object.values(breakdown).reduce((a, b) => a + b, 0), breakdown };
}

/** Cosine similarity. Returns 0 when either vector is absent or degenerate. */
export function cosine(a: number[] | undefined, b: number[] | undefined): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
