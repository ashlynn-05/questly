import { expect, test } from "vitest";
import { clockFace, secondsLeft } from "../../../src/lib/countdown";

/**
 * The countdown is derived from an instant and the current clock, so all of it
 * is testable without a DOM -- which is the point of it living here rather than
 * inside the two components that draw it.
 */

const NOW = 1_800_000_000_000;

test("a fresh timer reads its full length, not one second less", () => {
  expect(secondsLeft(NOW + 30_000, NOW)).toBe(30);
  expect(secondsLeft(NOW + 15_000, NOW)).toBe(15);
});

test("a part second still counts as a second left, until there is none", () => {
  // The last whole second of a card has to read "1" and not "0": zero is the
  // value the deck acts on, and acting on it half a second early would pass a
  // card out from under someone.
  expect(secondsLeft(NOW + 1, NOW)).toBe(1);
  expect(secondsLeft(NOW + 999, NOW)).toBe(1);
  expect(secondsLeft(NOW + 1000, NOW)).toBe(1);
  expect(secondsLeft(NOW + 1001, NOW)).toBe(2);
});

test("the deadline itself, and everything past it, is out of time", () => {
  expect(secondsLeft(NOW, NOW)).toBe(0);
  expect(secondsLeft(NOW - 1, NOW)).toBe(0);
  // The backgrounded-tab case: two minutes asleep on a thirty second card does
  // not come back with a negative number, it comes back out of time.
  expect(secondsLeft(NOW + 30_000, NOW + 150_000)).toBe(0);
});

test("the clock face pads the seconds and never goes negative", () => {
  expect(clockFace(65)).toBe("1:05");
  expect(clockFace(9)).toBe("0:09");
  expect(clockFace(120)).toBe("2:00");
  expect(clockFace(0)).toBe("0:00");
  expect(clockFace(-5)).toBe("0:00");
});
