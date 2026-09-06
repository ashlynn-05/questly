/**
 * Ranking maths. Deliberately free of Convex imports so it can be unit-tested
 * directly and reasoned about on its own.
 */

export type Mood = "grass" | "meet" | "treat" | "new";

/** Mood drives the Places query. It is a filter, not a theme. */
export const MOOD_TYPES: Record<Mood, string[]> = {
  grass: ["park", "hiking_area", "beach", "garden"],
  meet: ["bar", "night_club", "community_center", "cafe"],
  treat: ["restaurant", "spa", "movie_theater", "bakery"],
  new: ["art_gallery", "museum", "tourist_attraction", "bowling_alley"],
};

/** Types that are genuinely free to enter, for a $0 budget. */
export const FREE_TYPES = ["park", "hiking_area", "beach", "garden", "tourist_attraction"];

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
 */
export function priceLevelToCents(level: string | null | undefined): number {
  if (level && level in PRICE_BANDS) return PRICE_BANDS[level];
  return PRICE_BANDS.PRICE_LEVEL_MODERATE;
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
  priceCents: number;
  budgetPerHeadCents: number;
  distanceKm: number;
  radiusKm: number;
  discountPct: number;
  /** 0 = not a partner. Higher tiers rank higher. This is the revenue lever. */
  partnerTier: number;
  moodMatch: boolean;
  /** Cosine similarity against the room's blended taste vector, -1..1. */
  tasteSimilarity: number;
};

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
  if (input.budgetPerHeadCents === 0) {
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
  const moodFit = input.moodMatch ? 1 : 0;
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
