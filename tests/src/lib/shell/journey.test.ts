import { expect, test } from "vitest";
import { journeyModel, STAGE_COUNT } from "../../../../src/lib/shell/journey";
import type { Stop } from "../../../../src/components/questly/Concourse";

/**
 * The stepper collapses eight stops onto five stages, and the whole risk of
 * that collapse is a stop with no stage: the row would draw with nothing live
 * on it and no error anywhere to say why. So the first test is totality over
 * the union, not a spot check of the interesting cases.
 */

const EVERY_STOP: Stop[] = [
  "quiz",
  "mood",
  "party",
  "constraints",
  "room",
  "swiping",
  "matched",
  "booked",
];

test("every stop in the union produces a full row of stages", () => {
  for (const stop of EVERY_STOP) {
    const stages = journeyModel(stop);
    expect(stages, stop).toHaveLength(STAGE_COUNT);
  }
});

test("every stop except booked marks exactly one stage live", () => {
  for (const stop of EVERY_STOP.filter((s) => s !== "booked")) {
    const live = journeyModel(stop).filter((s) => s.state === "live");
    expect(live.map((s) => s.id), stop).toHaveLength(1);
  }
});

test("booked locks all five and marks nothing live", () => {
  const stages = journeyModel("booked");
  expect(stages.every((s) => s.state === "locked")).toBe(true);
  expect(stages.some((s) => s.state === "live")).toBe(false);
});

test("stops before the live stage are locked and stops after are open", () => {
  const stages = journeyModel("room");
  expect(stages.map((s) => s.state)).toEqual(["locked", "locked", "locked", "live", "open"]);
});

test("the sittings that share a stage land on the same one", () => {
  // Two questions in one sitting, so one stage.
  expect(journeyModel("quiz").findIndex((s) => s.state === "live")).toBe(
    journeyModel("mood").findIndex((s) => s.state === "live"),
  );
  // The deck arriving is not somewhere anybody stands.
  expect(journeyModel("room").findIndex((s) => s.state === "live")).toBe(
    journeyModel("swiping").findIndex((s) => s.state === "live"),
  );
});

test("the funnel walks forwards through the stages and never backwards", () => {
  const order: Stop[] = ["mood", "party", "constraints", "room", "matched"];
  const live = order.map((stop) => journeyModel(stop).findIndex((s) => s.state === "live"));
  expect(live).toEqual([...live].sort((a, b) => a - b));
  expect(new Set(live).size).toBe(order.length);
});

test("only the last stage draws no joining line", () => {
  const stages = journeyModel("mood");
  expect(stages.map((s) => s.line)).toEqual([true, true, true, true, false]);
});

test("the labels are stable whichever stop is live", () => {
  const labels = (stop: Stop) => journeyModel(stop).map((s) => s.label);
  expect(labels("quiz")).toEqual(labels("booked"));
  expect(labels("mood")).toEqual(["Mood", "Who", "Limits", "Room", "Plan"]);
});
