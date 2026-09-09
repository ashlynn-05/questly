import { describe, expect, test } from "vitest";
import {
  cosine, distanceKm, priceLevelToCents, scoreQuest, moodAffinityMultiplier, MOOD_TYPES,
} from "../../../../convex/lib/deck/scoring";

const base = {
  priceCents: 2000,
  budgetPerHeadCents: 3000,
  distanceKm: 1,
  radiusKm: 5,
  discountPct: 0,
  partnerTier: 0,
  moodMatch: true,
  // No quiz answers behind this room, which is the neutral case: every
  // assertion below is about the term it names, not about personalisation.
  moodAffinity: 0,
  tasteSimilarity: 0,
};

describe("distanceKm", () => {
  test("is zero for the same point", () => {
    expect(distanceKm(-37.8, 144.96, -37.8, 144.96)).toBe(0);
  });

  test("Melbourne CBD to Carlton is roughly 2km", () => {
    const d = distanceKm(-37.8136, 144.9631, -37.8001, 144.9674);
    expect(d).toBeGreaterThan(1);
    expect(d).toBeLessThan(2.5);
  });
});

describe("priceLevelToCents", () => {
  test("maps the Places bands", () => {
    expect(priceLevelToCents("PRICE_LEVEL_FREE")).toBe(0);
    expect(priceLevelToCents("PRICE_LEVEL_INEXPENSIVE")).toBe(1500);
    expect(priceLevelToCents("PRICE_LEVEL_MODERATE")).toBe(3500);
    expect(priceLevelToCents("PRICE_LEVEL_EXPENSIVE")).toBe(7000);
    expect(priceLevelToCents("PRICE_LEVEL_VERY_EXPENSIVE")).toBe(12000);
  });

  // Google not telling us a price is not the same as Google telling us the
  // price is moderate. Inventing $35 a head here is how a made-up number ends
  // up printed on a card as if it were fact, so an unknown band stays unknown
  // and the caller has to decide what to say about it.
  test("an unknown or absent level has no price, rather than a guessed one", () => {
    expect(priceLevelToCents(null)).toBeNull();
    expect(priceLevelToCents(undefined)).toBeNull();
    expect(priceLevelToCents("NONSENSE")).toBeNull();
  });
});

describe("scoreQuest", () => {
  test("over budget scores below any in-budget option", () => {
    expect(scoreQuest({ ...base, priceCents: 9000 }).score).toBeLessThan(scoreQuest(base).score);
  });

  test("a $0 budget rejects anything that costs money", () => {
    const free = scoreQuest({ ...base, budgetPerHeadCents: 0, priceCents: 0 }).score;
    const paid = scoreQuest({ ...base, budgetPerHeadCents: 0, priceCents: 500 }).score;
    expect(free).toBeGreaterThan(paid);
    expect(paid).toBeLessThan(0);
  });

  test("partner tier lifts the score", () => {
    expect(scoreQuest({ ...base, partnerTier: 2 }).score).toBeGreaterThan(scoreQuest(base).score);
  });

  test("nearer beats further, all else equal", () => {
    const near = scoreQuest({ ...base, distanceKm: 0.5 }).score;
    const far = scoreQuest({ ...base, distanceKm: 4.5 }).score;
    expect(near).toBeGreaterThan(far);
  });

  test("the breakdown names every term, so the pitch can show the maths", () => {
    expect(Object.keys(scoreQuest(base).breakdown).sort()).toEqual([
      "budgetFit", "discountFit", "distanceDecay", "moodFit", "partnerBoost", "tasteSimilarity",
    ]);
  });

  // The quiz's mood answers were computed, stored and then read by nothing at
  // all -- personalisation the product claims and never delivered. They now
  // scale the mood term.
  test("a room that likes tonight's mood ranks a matching card higher", () => {
    const keen = scoreQuest({ ...base, moodAffinity: 2 }).score;
    const neutral = scoreQuest({ ...base, moodAffinity: 0 }).score;
    const lukewarm = scoreQuest({ ...base, moodAffinity: -2 }).score;
    expect(keen).toBeGreaterThan(neutral);
    expect(neutral).toBeGreaterThan(lukewarm);
  });

  test("affinity scales a mood match; it cannot manufacture one", () => {
    const noMatch = scoreQuest({ ...base, moodMatch: false, moodAffinity: 2 });
    expect(noMatch.breakdown.moodFit).toBe(0);
  });

  // A room of guests has answered no quiz, and must score exactly as it did
  // before any of this existed.
  test("no quiz answers is neutral, not a penalty", () => {
    expect(moodAffinityMultiplier(0)).toBe(1);
    expect(scoreQuest(base).breakdown.moodFit).toBeCloseTo(1.2);
  });

  // Personalisation breaks ties. It does not overrule the things the group
  // actually told us -- their budget and how far they are willing to go.
  test("affinity cannot outweigh being over budget", () => {
    const keenButPricey = scoreQuest({
      ...base, moodAffinity: 2, priceCents: 9000, budgetPerHeadCents: 3000,
    }).score;
    const indifferentAndAffordable = scoreQuest({ ...base, moodAffinity: -2 }).score;
    expect(indifferentAndAffordable).toBeGreaterThan(keenButPricey);
  });

  test("the multiplier is bounded however extreme the answers", () => {
    expect(moodAffinityMultiplier(50)).toBe(1.5);
    expect(moodAffinityMultiplier(-50)).toBe(0.5);
  });

  test("mood is a real query dimension, not decoration", () => {
    expect(MOOD_TYPES.grass).toContain("park");
    expect(MOOD_TYPES.treat).not.toContain("park");
  });
});

describe("cosine", () => {
  test("identical vectors score 1", () => {
    expect(cosine([1, 0, 1], [1, 0, 1])).toBeCloseTo(1);
  });

  test("a missing or mismatched vector scores 0 rather than throwing", () => {
    expect(cosine(undefined, [1, 2])).toBe(0);
    expect(cosine([1, 2], [1, 2, 3])).toBe(0);
    expect(cosine([0, 0], [0, 0])).toBe(0);
  });
});
