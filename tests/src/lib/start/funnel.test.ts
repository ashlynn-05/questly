import { expect, test } from "vitest";
import { EMPTY_DRAFT, parseDraft, type FunnelDraft } from "../../../../src/lib/start/funnel";

/**
 * `parseDraft` is the only part of the funnel's survival that is testable in
 * this suite: vitest runs one global edge-runtime environment with no DOM, so
 * `sessionStorage`, `useSyncExternalStore` and the page itself are out of reach
 * on purpose. What IS in reach is the thing most likely to break somebody's
 * night -- a value that came back out of a browser store and was trusted.
 */

const FULL: FunnelDraft = {
  step: "constraints",
  answers: { "card-1": "more", "card-2": "less" },
  cardIndex: 6,
  goals: ["reset", "meet-someone"],
  mood: "treat",
  visibility: "open",
  headcount: 6,
  budget: 5000,
  radiusKm: 20,
  whenId: "weekend",
  whenMinutes: 20 * 60 + 15,
  quizSaved: true,
};

test("a draft survives the round trip through JSON unchanged", () => {
  expect(parseDraft(JSON.stringify(FULL))).toEqual(FULL);
});

test("nothing to restore reads as nothing to restore", () => {
  expect(parseDraft(null)).toBeNull();
  expect(parseDraft("")).toBeNull();
});

test("a payload that is not an object is refused outright", () => {
  expect(parseDraft("not json at all")).toBeNull();
  expect(parseDraft("[1,2,3]")).toBeNull();
  expect(parseDraft("null")).toBeNull();
  expect(parseDraft('"a string"')).toBeNull();
  expect(parseDraft("42")).toBeNull();
});

// The whole point of validating rather than casting: these values are typed
// into a browser store, and `mood` in particular is sent straight to
// `rooms.create`, whose validator would reject the room outright.
test("a value outside its option set falls back rather than being trusted", () => {
  const parsed = parseDraft(
    JSON.stringify({
      ...FULL,
      step: "sideways",
      mood: "chaos",
      visibility: "secret",
      headcount: 99,
      budget: 999999,
      radiusKm: 4000,
      whenId: "someday",
    }),
  );
  expect(parsed).not.toBeNull();
  expect(parsed?.step).toBeNull();
  expect(parsed?.mood).toBeNull();
  expect(parsed?.visibility).toBe("private");
  expect(parsed?.headcount).toBe(EMPTY_DRAFT.headcount);
  expect(parsed?.budget).toBe(EMPTY_DRAFT.budget);
  expect(parsed?.radiusKm).toBe(EMPTY_DRAFT.radiusKm);
  expect(parsed?.whenId).toBe(EMPTY_DRAFT.whenId);
});

// The chosen start time. It is minutes since midnight, so anything that is not
// a whole number of minutes inside one day is not a time of day -- and a bad
// one falling through would resolve to a room at some hour nobody picked.
test("a stored start time that is not a time of day falls back to the preset", () => {
  for (const whenMinutes of [-1, 1440, 12.5, "18:30", null, {}]) {
    const parsed = parseDraft(JSON.stringify({ ...FULL, whenMinutes }));
    expect(parsed?.whenMinutes).toBe(EMPTY_DRAFT.whenMinutes);
  }
});

test("a stored start time that IS a time of day survives", () => {
  expect(parseDraft(JSON.stringify({ ...FULL, whenMinutes: 0 }))?.whenMinutes).toBe(0);
  expect(parseDraft(JSON.stringify({ ...FULL, whenMinutes: 1439 }))?.whenMinutes).toBe(1439);
});

// One bad field must not cost the other eleven answers -- re-asking twelve
// questions is the defect this whole file exists to prevent.
test("one unusable field does not throw away the rest of the funnel", () => {
  const parsed = parseDraft(JSON.stringify({ ...FULL, budget: "heaps" }));
  expect(parsed?.budget).toBe(EMPTY_DRAFT.budget);
  expect(parsed?.answers).toEqual(FULL.answers);
  expect(parsed?.goals).toEqual(FULL.goals);
  expect(parsed?.mood).toBe("treat");
  expect(parsed?.step).toBe("constraints");
});

test("quiz answers that are not more-or-less are dropped, one by one", () => {
  const parsed = parseDraft(
    JSON.stringify({ ...FULL, answers: { good: "more", bad: "maybe", worse: 7 } }),
  );
  expect(parsed?.answers).toEqual({ good: "more" });
});

test("goals keep only the strings", () => {
  const parsed = parseDraft(JSON.stringify({ ...FULL, goals: ["reset", 3, null, "quiet"] }));
  expect(parsed?.goals).toEqual(["reset", "quiet"]);
});

test("a missing or nonsensical card index restarts the quiz rather than skipping it", () => {
  expect(parseDraft(JSON.stringify({ ...FULL, cardIndex: -3 }))?.cardIndex).toBe(0);
  expect(parseDraft(JSON.stringify({ ...FULL, cardIndex: 2.5 }))?.cardIndex).toBe(0);
  expect(parseDraft("{}")?.cardIndex).toBe(0);
});

// `quizSaved` gates a second `profiles.saveQuiz` call after sign-in. Anything
// that is not literally true has to mean "not saved", or the answers a
// signed-out visitor gave are silently never stored.
test("quizSaved is only ever true when it was stored as true", () => {
  expect(parseDraft(JSON.stringify({ ...FULL, quizSaved: "yes" }))?.quizSaved).toBe(false);
  expect(parseDraft(JSON.stringify({ ...FULL, quizSaved: 1 }))?.quizSaved).toBe(false);
  expect(parseDraft("{}")?.quizSaved).toBe(false);
  expect(parseDraft(JSON.stringify(FULL))?.quizSaved).toBe(true);
});

test("an empty object restores as the empty draft, not as null", () => {
  expect(parseDraft("{}")).toEqual(EMPTY_DRAFT);
});
