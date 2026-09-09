import { expect, test } from "vitest";
// Relative, not the `@convex/*` alias, matching `photo.test.ts` in this folder.
import { UNNAMED_STOP } from "../../../../convex/lib/plans/stops";
import { MAPS_AREA } from "../../../../src/lib/room/maps";
import { moneyLabel, planShareText, timeLabel } from "../../../../src/lib/room/share";

/**
 * What actually lands in the group chat.
 *
 * The message used to be `plan.shareMessage` alone -- one model-written line
 * with no times, no prices and no way to find anywhere. These assert the parts
 * a reader of that chat needs and cannot reconstruct: a bullet per stop, a map
 * link under each one, the whole route as a single link, and the room.
 */

/**
 * LOCAL time, built field by field rather than parsed from an offset string.
 *
 * `timeLabel` and the date line both format in the runtime's own zone, so a
 * fixed instant asserts one thing on this machine and another in a UTC CI
 * container. Constructed this way, 6:30pm is 6:30pm wherever the suite runs.
 * Friday, so the weekday below is not a coincidence of the current week.
 */
const AT = new Date(2026, 8, 11, 18, 30).getTime();
const HOUR = 60 * 60 * 1000;

const stop = (name: string, startAt: number, costPerHeadCents = 0, placeId?: string) => ({
  id: name,
  name,
  startAt,
  costPerHeadCents,
  placeId,
});

const NIGHT = [
  stop("Federation Square", AT),
  stop("Garden For Everyone", AT + HOUR, 1800),
  stop("Yarra River Promenade", AT + 2 * HOUR),
];

const text = (over: Partial<Parameters<typeof planShareText>[0]> = {}) =>
  planShareText({
    intro: "Plan's set -- see you there.",
    stops: NIGHT,
    perHeadCents: 1800,
    roomUrl: "https://questly.app/room/4902",
    ...over,
  });

// The clock's own words. Hard-coding "6:30 pm" would assert the ICU data this
// machine happens to ship -- en-AU writes the meridiem as "pm" in current
// versions and "PM" in older ones -- and the composition is what these tests
// are actually about.
const at = (startAt: number) => timeLabel(startAt);

test("every stop is a bullet carrying its time, its name and its price", () => {
  const lines = text().split("\n");
  expect(lines).toContain(`• ${at(AT)} — Federation Square (Free)`);
  expect(lines).toContain(`• ${at(AT + HOUR)} — Garden For Everyone ($18)`);
});

test("each bullet is followed by a link to that one place", () => {
  const lines = text().split("\n");
  const under = lines[lines.indexOf(`• ${at(AT)} — Federation Square (Free)`) + 1].trim();
  const url = new URL(under);
  expect(url.origin + url.pathname).toBe("https://www.google.com/maps/search/");
  expect(url.searchParams.get("query")).toBe(`Federation Square, ${MAPS_AREA}`);
});

test("the stacked link puts the whole night on one map", () => {
  // The thing nobody can rebuild from three separate pins, and the reason the
  // per-stop links are not the whole answer.
  const route = text()
    .split("\n")
    .find((line) => line.includes("/maps/dir/"));
  const url = new URL(route ?? "");
  expect(url.searchParams.get("origin")).toBe(`Federation Square, ${MAPS_AREA}`);
  expect(url.searchParams.get("waypoints")).toBe(`Garden For Everyone, ${MAPS_AREA}`);
  expect(url.searchParams.get("destination")).toBe(`Yarra River Promenade, ${MAPS_AREA}`);
});

test("the model's own line opens it, and the room closes it", () => {
  const message = text();
  expect(message.startsWith("Plan's set -- see you there.")).toBe(true);
  // Last, and the only link that is not a map: somebody who reads this in a
  // chat needs a way back to the reference and the stops.
  expect(message.trimEnd().endsWith("$18 each. The room: https://questly.app/room/4902")).toBe(
    true,
  );
});

test("the date is stated, so a message read tomorrow is not read as tonight", () => {
  // The weekday and the month, not the punctuation between them: en-AU puts a
  // comma after the weekday in some ICU versions and not in others, and this
  // test is about the day being said at all.
  expect(text()).toContain("Friday");
  expect(text()).toContain("11 September");
});

test("a stop the model never named keeps its bullet and loses its link", () => {
  // Same ruling as the plan screen: no honest link beats a wrong pin. The stop
  // is still in the itinerary, because it is still part of the night.
  const message = planShareText({
    intro: "",
    stops: [stop(UNNAMED_STOP, AT), stop("Yarra River Promenade", AT + HOUR)],
    perHeadCents: 0,
    roomUrl: "https://questly.app/room/4902",
  });
  const lines = message.split("\n");
  const i = lines.findIndex((line) => line.includes(UNNAMED_STOP));
  expect(i).toBeGreaterThan(-1);
  expect(lines[i + 1]).not.toContain("http");
});

test("a plan with no route says everything else it can", () => {
  // One findable stop is not a journey, so there is no stacked link to give.
  // The bullet, the price and the room still go.
  const message = planShareText({
    intro: "Just the one.",
    stops: [stop("Federation Square", AT)],
    perHeadCents: 0,
    roomUrl: "https://questly.app/room/4902",
  });
  expect(message).not.toContain("/maps/dir/");
  expect(message).toContain(`• ${at(AT)} — Federation Square (Free)`);
  expect(message).toContain("Free each. The room: https://questly.app/room/4902");
});

test("an empty plan still sends something a person can act on", () => {
  // `Booked` renders before a plan is guaranteed to be there, so this is a
  // real input rather than a defensive one.
  const message = planShareText({
    intro: "",
    stops: [],
    perHeadCents: 0,
    roomUrl: "https://questly.app/room/4902",
  });
  expect(message).toBe("Free each. The room: https://questly.app/room/4902");
});

test("the screen and the message read the same clock and the same prices", () => {
  // `Booked.tsx` draws its stop rows with these two, so a change to either
  // cannot leave the chat saying a different time from the screen. The clock
  // is asserted case-insensitively for the ICU reason above; the money is this
  // file's own arithmetic and has no locale in it at all.
  expect(timeLabel(AT).toLowerCase()).toBe("6:30 pm");
  expect(moneyLabel(0)).toBe("Free");
  expect(moneyLabel(1850)).toBe("$19");
  // Rounded to the nearest dollar, not floored: $17.50 a head is nearer $18.
  expect(moneyLabel(1750)).toBe("$18");
});
