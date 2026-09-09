import { expect, test } from "vitest";
import { UNNAMED_STOP } from "../../../../convex/lib/plans/stops";
import { MAPS_AREA } from "../../../../src/lib/room/maps";
import { calendarUrl } from "../../../../src/lib/room/calendar";
import { planShareText } from "../../../../src/lib/room/share";

/**
 * The link that puts the agreed night in a diary.
 *
 * Every assertion here reads UTC or reads `planShareText`'s own output, so the
 * file says the same thing in Melbourne and in a UTC CI container.
 */

const AT = Date.UTC(2026, 8, 9, 8, 30); // 6:30pm Melbourne, stated as an instant.
const HOUR = 60 * 60 * 1000;

const stop = (name: string, startAt: number, durationMin: number, costPerHeadCents = 0) => ({
  id: name,
  name,
  startAt,
  durationMin,
  costPerHeadCents,
});

const NIGHT = [
  stop("Federation Square", AT, 30),
  stop("Garden For Everyone", AT + 0.75 * HOUR, 90, 1800),
  stop("Yarra River Promenade", AT + 2.5 * HOUR, 60),
];

const INPUT = {
  intro: "Plan's set -- see you there.",
  stops: NIGHT,
  perHeadCents: 1800,
  roomUrl: "https://questly.app/room/4902",
};

const url = (over: Partial<typeof INPUT> = {}) =>
  new URL(calendarUrl({ ...INPUT, ...over }) ?? "");

test("the link is Google's own template form", () => {
  const u = url();
  expect(u.origin + u.pathname).toBe("https://calendar.google.com/calendar/render");
  expect(u.searchParams.get("action")).toBe("TEMPLATE");
});

test("the night runs from the first stop to the end of the last", () => {
  // UTC with the Z, because Melbourne crosses a daylight-saving boundary in
  // October and this product plans nights on both sides of it.
  expect(url().searchParams.get("dates")).toBe("20260909T083000Z/20260909T120000Z");
});

test("the end comes from the last stop's own duration, not the travel buffer", () => {
  // 9:00pm plus its 60 minutes is 10:00pm. Adding TRAVEL_BUFFER_MIN would book
  // fifteen minutes of walking to nowhere onto the end of the evening.
  const short = [stop("Meet", AT, 30), stop("After", AT + HOUR, 45)];
  const ends = url({ stops: short }).searchParams.get("dates")?.split("/")[1];
  expect(ends).toBe("20260909T101500Z");
});

test("the description is the message the group chat gets, to the byte", () => {
  // Not a second formatter. Two would drift, and then the calendar entry and
  // the chat would disagree about a night they both claim to describe.
  expect(url().searchParams.get("details")).toBe(planShareText(INPUT));
});

test("the location is the first stop, disambiguated by the city", () => {
  // Google shows exactly one location, and the first stop is where people are
  // heading when the entry fires.
  expect(url().searchParams.get("location")).toBe(`Federation Square, ${MAPS_AREA}`);
});

test("the calendar row names the first stop and counts the rest", () => {
  expect(url().searchParams.get("text")).toBe("Questly: Federation Square and 2 more");
});

test("a one-stop night is named without a count", () => {
  const one = url({ stops: [stop("Federation Square", AT, 30)] });
  expect(one.searchParams.get("text")).toBe("Questly: Federation Square");
});

test("one stop is still an evening, where one stop is not a route", () => {
  // The deliberate difference from `stopsDirectionsUrl`, which needs somewhere
  // to start AND somewhere to end. A single place with a duration is a real
  // thing to put in a diary.
  const one = url({ stops: [stop("Federation Square", AT, 30)] });
  expect(one.searchParams.get("dates")).toBe("20260909T083000Z/20260909T090000Z");
});

test("a plan with no stops gets no link at all", () => {
  // Null rather than an event with no time and no place: the control is absent
  // instead of leading somewhere empty.
  expect(calendarUrl({ ...INPUT, stops: [] })).toBeNull();
});

test("a stop the model never named still holds its place in the times", () => {
  // It loses its map link inside the description, the way it does everywhere
  // else, but the night still starts and ends when it does.
  const u = url({ stops: [stop(UNNAMED_STOP, AT, 30), stop("After", AT + HOUR, 60)] });
  expect(u.searchParams.get("dates")).toBe("20260909T083000Z/20260909T103000Z");
  expect(u.searchParams.get("location")).toBe(`${UNNAMED_STOP}, ${MAPS_AREA}`);
});

test("a venue name carrying an ampersand survives the round trip", () => {
  // Unescaped it would end the query string early and silently drop every
  // parameter after it, which is a broken link with no error anywhere.
  const u = url({ stops: [stop("Bar & Grill", AT, 30)] });
  expect(u.searchParams.get("location")).toBe(`Bar & Grill, ${MAPS_AREA}`);
  expect(u.searchParams.get("text")).toBe("Questly: Bar & Grill");
});
