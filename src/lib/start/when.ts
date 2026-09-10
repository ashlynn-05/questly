/**
 * When the night starts: a day, and a time of day.
 *
 * The funnel used to offer three days at three hardcoded clock times, so every
 * group that wanted 8pm, or lunch, or 5:30 after work was silently given 6:30pm
 * and then watched it propagate into the room, the join screen and the plan.
 * The presets stay -- they are one tap, and one tap is the point -- but the
 * time is now a value, and this module is where it is resolved.
 *
 * NOTHING HERE STORES A TIMESTAMP. The draft carries a `whenId` and, if the
 * host moved it, minutes since local midnight; the epoch is computed at the
 * moment the room is opened. `src/lib/funnel.ts` explains why: a draft restored
 * tomorrow has to get tomorrow's "Tonight", not yesterday's stale one, and an
 * absolute time written down at 11pm is stale by construction the moment the
 * date rolls over.
 *
 * Everything below reads and writes the user's OWN clock -- `getDay`,
 * `setHours`, `setDate`, never a UTC method and never an ISO string. A room at
 * 6:30pm means 6:30pm where the person setting it is standing. `convex/seed.ts`
 * resolves the same 6:30pm against a fixed Melbourne timezone instead, because
 * a seeded room has no person behind it to have a clock.
 */

export const WHEN_IDS = ["tonight", "tomorrow", "weekend", "custom"] as const;
export type WhenId = (typeof WHEN_IDS)[number];

export const WHEN_LABELS: Record<WhenId, string> = {
  tonight: "Tonight",
  tomorrow: "Tomorrow",
  weekend: "This weekend",
  custom: "Another day",
};

/**
 * The time each preset means, as minutes since local midnight. 6:30pm for the
 * two weekday options and 2pm for the weekend one, which is what the three
 * hardcoded times were before there was any way to change them.
 */
export const PRESET_MINUTES: Record<WhenId, number> = {
  tonight: 18 * 60 + 30,
  tomorrow: 18 * 60 + 30,
  weekend: 14 * 60,
  // A chosen date says which day and nothing about the hour, so it opens on the
  // same evening the two weekday chips do and the host moves it from there.
  custom: 18 * 60 + 30,
};

const MINUTES_IN_DAY = 24 * 60;

/**
 * How many days ahead of `now` an option lands.
 *
 * The weekend is the NEXT Saturday, and `|| 7` is what makes a Saturday itself
 * resolve to the Saturday after rather than to zero days away: someone opening
 * a room on Saturday morning and picking "This weekend" means next weekend, and
 * "today at 2pm" is what the "Tonight" chip is for.
 */
export function dayOffset(id: WhenId, now: Date): number {
  // `custom` carries its own date and never asks this. Zero is what it gets if
  // the date is missing or unparseable, which makes an unanswered custom pick
  // behave as today -- visible in the field, and caught by `isInThePast` the
  // moment today's slot has gone.
  if (id === "custom") return 0;
  if (id === "tomorrow") return 1;
  if (id === "weekend") return (6 - now.getDay() + 7) % 7 || 7;
  return 0;
}

/**
 * The one place a `whenId` plus an optional time of day becomes an epoch.
 *
 * `minutes` of `null` means "follow the preset", which is what tapping a chip
 * restores -- so the fast path produces exactly the timestamp it always did.
 */
export function resolveWhenAt(
  id: WhenId,
  minutes: number | null,
  now: Date,
  date: string | null = null,
): number {
  const sinceMidnight = minutes ?? PRESET_MINUTES[id];
  const d = new Date(now.getTime());
  if (id === "custom" && isValidDateValue(date)) {
    // All three parts at once, because setting them one at a time walks
    // through invalid dates: the 31st of a month, moved to a 30-day month,
    // rolls into the next one before the day is written.
    const [year, month, day] = date.split("-").map(Number);
    d.setFullYear(year, month - 1, day);
  } else {
    d.setDate(d.getDate() + dayOffset(id, now));
  }
  d.setHours(Math.floor(sinceMidnight / 60), sinceMidnight % 60, 0, 0);
  return d.getTime();
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The `YYYY-MM-DD` an `<input type="date">` reads and writes, and a real day.
 *
 * The shape check is not enough on its own: `2026-02-31` matches it and is not
 * a date. Building it and asking whether the parts survived is what catches
 * that -- a rolled-over date reports a different month. This is the guard on a
 * value that comes back out of `sessionStorage`, so it is as strict as the
 * allow-lists every other constrained field goes through.
 */
export function isValidDateValue(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

/**
 * The same bridge the other way. Local parts, never `toISOString`, which is UTC
 * and therefore the wrong day for anyone east of Greenwich after their morning.
 */
export function dateToInputValue(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * Minutes since midnight, and nothing else.
 *
 * This is the guard on a value that comes back out of `sessionStorage`, where
 * anyone could have typed it, so it is at least as strict as the allow-lists
 * `headcount`, `budget` and `radiusKm` already go through: a whole number of
 * minutes inside one day. 1440 is midnight tomorrow, which is a different day
 * and therefore not a time of day.
 */
export function isValidMinutes(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < MINUTES_IN_DAY
  );
}

/**
 * A night that has already started is not a plan.
 *
 * This fires on the preset path too, not only on a time somebody chose:
 * "Tonight" tapped at 11pm resolves to 6:30pm today, which is five hours gone.
 * The client uses this for the sentence; `rooms.create` enforces the rule.
 */
export function isInThePast(at: number, now: number): boolean {
  return at <= now;
}

/** The `HH:MM` an `<input type="time">` reads and writes. */
export function minutesToInputValue(minutes: number): string {
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * The same bridge back. An empty string is what the input reports when it is
 * cleared or half-typed, and `null` is how that reaches the draft -- which
 * means "follow the preset", so a cleared field is never a broken room.
 */
export function inputValueToMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return isValidMinutes(minutes) ? minutes : null;
}

/**
 * When an open room is meeting. A clock face alone cannot separate tonight
 * 6:30pm from Saturday 2pm, and the difference is the whole commitment -- so
 * the weekday goes in front of the time for anything that is not today. Today
 * keeps the bare time: "Sat" on a room happening in four hours would be noise.
 */
export function roomWhenLabel(at: number, now: Date = new Date()): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
  const today =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return today ? time : `${d.toLocaleDateString("en-AU", { weekday: "short" })} ${time}`;
}
