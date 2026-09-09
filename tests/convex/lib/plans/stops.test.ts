import { expect, test } from "vitest";
import {
  recomputeItinerary, totalPerHeadCents, isOverBudget, TRAVEL_BUFFER_MIN, type Stop,
} from "../../../../convex/lib/plans/stops";

const S = (over: Partial<Stop>): Stop => ({
  id: "s1", slot: "main", name: "A", startAt: 0, durationMin: 60,
  costPerHeadCents: 0, note: "", source: "llm", locked: false, ...over,
});

const START = 1_800_000_000_000;

test("start times cascade with a travel buffer between stops", () => {
  const out = recomputeItinerary(
    [S({ id: "a", slot: "meet", durationMin: 30 }), S({ id: "b", slot: "main", durationMin: 90 })],
    START,
  );
  expect(out[0].startAt).toBe(START);
  expect(out[1].startAt).toBe(START + (30 + TRAVEL_BUFFER_MIN) * 60_000);
});

test("changing a stop's duration moves every later stop", () => {
  const first = recomputeItinerary([S({ id: "a", durationMin: 30 }), S({ id: "b" }), S({ id: "c" })], START);
  const second = recomputeItinerary([S({ id: "a", durationMin: 90 }), S({ id: "b" }), S({ id: "c" })], START);
  expect(second[2].startAt - first[2].startAt).toBe(60 * 60_000);
});

test("cost totals across stops", () => {
  expect(totalPerHeadCents([S({ costPerHeadCents: 1400 }), S({ costPerHeadCents: 600 })])).toBe(2000);
});

test("a free night totals zero", () => {
  expect(totalPerHeadCents([S({}), S({})])).toBe(0);
});

test("over budget is detected", () => {
  const stops = [S({ costPerHeadCents: 2000 }), S({ costPerHeadCents: 2000 })];
  expect(isOverBudget(stops, 3000)).toBe(true);
  expect(isOverBudget(stops, 4000)).toBe(false);
});

test("a $0 budget is blown by any cost at all", () => {
  expect(isOverBudget([S({ costPerHeadCents: 100 })], 0)).toBe(true);
  expect(isOverBudget([S({ costPerHeadCents: 0 })], 0)).toBe(false);
});
