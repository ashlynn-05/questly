import { expect, test } from "vitest";
import { voteDeadlineAt, voteLapsed, votesNeeded } from "../../../convex/lib/rules";

/**
 * The two decisions the finalize vote rests on -- how many yeses settle it, and
 * whether the window they were cast in is still open -- pinned away from the
 * mutation that uses them, because both are arithmetic and neither needs a
 * database to be wrong.
 */

const START = 1_800_000_000_000;

test("everyone means everyone, however many that is", () => {
  expect(votesNeeded("all", 1)).toBe(1);
  expect(votesNeeded("all", 2)).toBe(2);
  expect(votesNeeded("all", 5)).toBe(5);
});

test("a majority is a strict one, so half the room is not enough", () => {
  // The same rule a stop swap already needs, and deliberately the same helper:
  // a second majority that rounded the other way would mean a room could book
  // a night it could not swap a stop in.
  expect(votesNeeded("majority", 2)).toBe(2);
  expect(votesNeeded("majority", 3)).toBe(2);
  expect(votesNeeded("majority", 4)).toBe(3);
  expect(votesNeeded("majority", 5)).toBe(3);
});

test("the two rules that are one person are one person, whoever is in the room", () => {
  expect(votesNeeded("anyone", 4)).toBe(1);
  expect(votesNeeded("host", 4)).toBe(1);
});

test("a vote with no window and a room with no vote both have no deadline", () => {
  expect(voteDeadlineAt(START, 0)).toBeNull();
  expect(voteDeadlineAt(undefined, 300)).toBeNull();
  expect(voteDeadlineAt(START, 300)).toBe(START + 300_000);
});

test("a window runs out AT its deadline, not a second after it", () => {
  expect(voteLapsed(START, 60, START + 59_999)).toBe(false);
  expect(voteLapsed(START, 60, START + 60_000)).toBe(true);
  expect(voteLapsed(START, 60, START + 600_000)).toBe(true);
});

test("a window that was never given a length never runs out", () => {
  // "No limit" is an offered option, and it has to mean it: a room that leaves
  // the vote open until people are ready must not have its votes quietly
  // dropped the first time somebody taps.
  expect(voteLapsed(START, 0, START + 10_000_000)).toBe(false);
  expect(voteLapsed(undefined, 60, START)).toBe(false);
});
