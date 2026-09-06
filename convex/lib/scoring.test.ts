import { describe, expect, test } from "vitest";
import { cosine, distanceKm, priceLevelToCents, scoreQuest, MOOD_TYPES } from "./scoring";

const base = {
  priceCents: 2000,
  budgetPerHeadCents: 3000,
  distanceKm: 1,
  radiusKm: 5,
  discountPct: 0,
  partnerTier: 0,
  moodMatch: true,
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

  test("an unknown or absent level is treated as moderate", () => {
    expect(priceLevelToCents(null)).toBe(3500);
    expect(priceLevelToCents(undefined)).toBe(3500);
    expect(priceLevelToCents("NONSENSE")).toBe(3500);
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
