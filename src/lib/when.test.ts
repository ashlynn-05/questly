import { expect, test } from "vitest";
import {
  PRESET_MINUTES,
  dayOffset,
  inputValueToMinutes,
  isInThePast,
  isValidMinutes,
  minutesToInputValue,
  resolveWhenAt,
  roomWhenLabel,
} from "./when";

/**
 * The time math, which is the half of the when-picker that can be wrong
 * silently. The control itself is not reachable here -- vitest runs one edge
 * runtime with no DOM on purpose -- so what is pinned is everything the page
 * hands over: which day an option lands on, what time of day it carries, that
 * both are read in the caller's own clock, and that a value out of
 * `sessionStorage` is refused before it can become a room.
 *
 * Every clock below is an explicit `new Date(...)` built from local parts, for
 * the same reason the module under test never touches a UTC method: an ISO
 * string here would pin the behaviour to whatever timezone the suite happens
 * to run in, which is exactly the bug these tests exist to catch.
 */

/** A Wednesday, 10:00 local. */
const WEDNESDAY = new Date(2026, 8, 9, 10, 0, 0, 0);
/** A Saturday, 10:00 local. */
const SATURDAY = new Date(2026, 8, 12, 10, 0, 0, 0);

test("the presets are the three times the funnel offered before it offered any", () => {
  expect(PRESET_MINUTES.tonight).toBe(18 * 60 + 30);
  expect(PRESET_MINUTES.tomorrow).toBe(18 * 60 + 30);
  expect(PRESET_MINUTES.weekend).toBe(14 * 60);
});

test("tonight is today, tomorrow is one day on", () => {
  expect(dayOffset("tonight", WEDNESDAY)).toBe(0);
  expect(dayOffset("tomorrow", WEDNESDAY)).toBe(1);
});

test("the weekend is the next Saturday", () => {
  // Wednesday is day 3, so Saturday is three days away.
  expect(dayOffset("weekend", WEDNESDAY)).toBe(3);
});

test("on a Saturday, the weekend is the NEXT one and never today", () => {
  // `|| 7` is the whole point: (6 - 6 + 7) % 7 is 0, and a room "this weekend"
  // opened on Saturday morning must not silently mean this afternoon.
  expect(dayOffset("weekend", SATURDAY)).toBe(7);
});

test("a preset resolves to its own time of day, on its own day", () => {
  const at = new Date(resolveWhenAt("tonight", null, WEDNESDAY));
  expect(at.getDate()).toBe(9);
  expect(at.getHours()).toBe(18);
  expect(at.getMinutes()).toBe(30);

  const weekend = new Date(resolveWhenAt("weekend", null, WEDNESDAY));
  expect(weekend.getDay()).toBe(6);
  expect(weekend.getHours()).toBe(14);
  expect(weekend.getMinutes()).toBe(0);
});

test("a chosen time replaces the preset's clock and keeps the preset's day", () => {
  const at = new Date(resolveWhenAt("tomorrow", 20 * 60 + 15, WEDNESDAY));
  expect(at.getDate()).toBe(10);
  expect(at.getHours()).toBe(20);
  expect(at.getMinutes()).toBe(15);
});

test("the resolved time is in the caller's own clock, whatever clock that is", () => {
  // Asserted through the LOCAL accessors, never a UTC one or an ISO string:
  // 8pm has to mean 8pm where the host is standing, and this is the property
  // that quietly dies the moment somebody reaches for toISOString().
  const at = new Date(resolveWhenAt("tonight", 8 * 60, WEDNESDAY));
  expect(at.getHours()).toBe(8);
  expect(at.getMinutes()).toBe(0);
  expect(at.getSeconds()).toBe(0);
  expect(at.getMilliseconds()).toBe(0);
});

test("resolving does not mutate the clock it was handed", () => {
  const now = new Date(WEDNESDAY.getTime());
  resolveWhenAt("weekend", 9 * 60, now);
  expect(now.getTime()).toBe(WEDNESDAY.getTime());
});

test("midnight and one minute to midnight both resolve", () => {
  const midnight = new Date(resolveWhenAt("tonight", 0, WEDNESDAY));
  expect(midnight.getHours()).toBe(0);
  expect(midnight.getMinutes()).toBe(0);

  const last = new Date(resolveWhenAt("tonight", 23 * 60 + 59, WEDNESDAY));
  expect(last.getHours()).toBe(23);
  expect(last.getMinutes()).toBe(59);
});

test("a time already reached is in the past, including this exact instant", () => {
  const now = 1_000_000;
  expect(isInThePast(now - 1, now)).toBe(true);
  expect(isInThePast(now, now)).toBe(true);
  expect(isInThePast(now + 1, now)).toBe(false);
});

test("tonight's preset is in the past when tonight is over", () => {
  // The case the issue is really about: this fires on the DEFAULT path, not
  // only on a time somebody typed.
  const elevenPm = new Date(2026, 8, 9, 23, 0, 0, 0);
  expect(isInThePast(resolveWhenAt("tonight", null, elevenPm), elevenPm.getTime())).toBe(true);
  expect(isInThePast(resolveWhenAt("tomorrow", null, elevenPm), elevenPm.getTime())).toBe(false);
});

test("only a whole number of minutes inside one day is a time of day", () => {
  expect(isValidMinutes(0)).toBe(true);
  expect(isValidMinutes(1110)).toBe(true);
  expect(isValidMinutes(1439)).toBe(true);

  expect(isValidMinutes(1440)).toBe(false);
  expect(isValidMinutes(-1)).toBe(false);
  expect(isValidMinutes(12.5)).toBe(false);
  expect(isValidMinutes(NaN)).toBe(false);
  expect(isValidMinutes(Infinity)).toBe(false);
  expect(isValidMinutes("18:30")).toBe(false);
  expect(isValidMinutes(null)).toBe(false);
  expect(isValidMinutes(undefined)).toBe(false);
});

test("minutes and the input's HH:MM round trip", () => {
  expect(minutesToInputValue(18 * 60 + 30)).toBe("18:30");
  expect(minutesToInputValue(0)).toBe("00:00");
  expect(minutesToInputValue(9 * 60 + 5)).toBe("09:05");

  expect(inputValueToMinutes("18:30")).toBe(18 * 60 + 30);
  expect(inputValueToMinutes("00:00")).toBe(0);
  // Some browsers hand back seconds; the day is still what matters.
  expect(inputValueToMinutes("09:05:00")).toBe(9 * 60 + 5);
});

test("a cleared or half-typed field is null, which means follow the preset", () => {
  expect(inputValueToMinutes("")).toBeNull();
  expect(inputValueToMinutes("1")).toBeNull();
  expect(inputValueToMinutes("nonsense")).toBeNull();
  expect(inputValueToMinutes("99:99")).toBeNull();
});

test("a room today keeps the bare time, and anything else gets its weekday", () => {
  // The property acceptance criterion 5 asks to keep: a clock face alone
  // cannot separate tonight 6:30pm from Saturday 2pm.
  const today = resolveWhenAt("tonight", null, WEDNESDAY);
  expect(roomWhenLabel(today, WEDNESDAY)).not.toMatch(/[A-Za-z]{3}\s/);

  const saturday = resolveWhenAt("weekend", null, WEDNESDAY);
  expect(roomWhenLabel(saturday, WEDNESDAY)).toMatch(/^Sat\s/);
});

test("the same clock face on a different day is still labelled differently", () => {
  const tonight = resolveWhenAt("tonight", 18 * 60, WEDNESDAY);
  const tomorrow = resolveWhenAt("tomorrow", 18 * 60, WEDNESDAY);
  expect(roomWhenLabel(tonight, WEDNESDAY)).not.toBe(roomWhenLabel(tomorrow, WEDNESDAY));
});
