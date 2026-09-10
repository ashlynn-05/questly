import { expect, test } from "vitest";
import { budgetModel } from "../../../../src/lib/room/budget";

/**
 * The bar's denominator is a real zero. `$0` is the first budget chip and the
 * product means it, so the free-room cases below are not defensive padding --
 * they are the shape most likely to reach a user, and the one where the naive
 * arithmetic draws an over-budget plan as an empty bar.
 */

test("an empty plan draws nothing and is within budget", () => {
  expect(budgetModel(0, 5000)).toEqual({ percent: 0, over: false, tone: "accent" });
});

test("a plan under budget draws its share", () => {
  expect(budgetModel(2500, 5000).percent).toBe(50);
  expect(budgetModel(2500, 5000).over).toBe(false);
});

test("a plan exactly at budget is full and NOT over", () => {
  const m = budgetModel(5000, 5000);
  expect(m.percent).toBe(100);
  expect(m.over).toBe(false);
  expect(m.tone).toBe("accent");
});

test("a plan one cent over is over", () => {
  const m = budgetModel(5001, 5000);
  expect(m.over).toBe(true);
  expect(m.tone).toBe("danger");
});

test("an over-budget plan clamps to a full bar rather than overflowing it", () => {
  expect(budgetModel(20000, 5000).percent).toBe(100);
});

test("a free room with a paid plan is full, over, and never NaN", () => {
  const m = budgetModel(1200, 0);
  expect(Number.isNaN(m.percent)).toBe(false);
  expect(Number.isFinite(m.percent)).toBe(true);
  expect(m).toEqual({ percent: 100, over: true, tone: "danger" });
});

test("a free room with a free plan is empty and within budget", () => {
  const m = budgetModel(0, 0);
  expect(Number.isNaN(m.percent)).toBe(false);
  expect(m).toEqual({ percent: 0, over: false, tone: "accent" });
});

test("the percentage is always a drawable 0-100", () => {
  const cases: [number, number][] = [
    [0, 0],
    [0, 5000],
    [1, 0],
    [5000, 5000],
    [999999, 100],
    [-500, 5000],
    [500, -5000],
  ];
  for (const [spent, budget] of cases) {
    const { percent } = budgetModel(spent, budget);
    expect(Number.isFinite(percent), `${spent}/${budget}`).toBe(true);
    expect(percent, `${spent}/${budget}`).toBeGreaterThanOrEqual(0);
    expect(percent, `${spent}/${budget}`).toBeLessThanOrEqual(100);
  }
});

test("the tone is only ever a role name the theme has measured", () => {
  for (const tone of [budgetModel(0, 100).tone, budgetModel(200, 100).tone]) {
    expect(["accent", "danger"]).toContain(tone);
  }
});
