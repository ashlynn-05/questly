import { internalMutation } from "./_generated/server";
import { newSessionKey } from "./lib/access";

/**
 * Demonstration inventory. These are invented businesses at real Melbourne
 * coordinates -- they are NOT real venues and NOT real commercial agreements.
 * Nothing in the product may present them as signed partners.
 */
export const PARTNERS = [
  {
    placeId: "questly-demo-long-weekend",
    name: "The Long Weekend", suburb: "Carlton",
    lat: -37.8003, lng: 144.9674,
    priceFromCents: 1800, discountPct: 25,
    offerText: "25% off the kitchen, Tuesday to Thursday",
    partnerTier: 3, moods: ["treat" as const], active: true,
  },
  {
    placeId: "questly-demo-nightjar",
    name: "Nightjar", suburb: "Fitzroy",
    lat: -37.7986, lng: 144.9784,
    priceFromCents: 1400, discountPct: 20,
    offerText: "First round on the house for groups of four",
    partnerTier: 3, moods: ["meet" as const], active: true,
  },
  {
    placeId: "questly-demo-second-wind",
    name: "Second Wind", suburb: "Brunswick",
    lat: -37.7667, lng: 144.9601,
    priceFromCents: 1600, discountPct: 15,
    offerText: "15% off midweek bookings",
    partnerTier: 2, moods: ["meet" as const, "treat" as const], active: true,
  },
  {
    placeId: "questly-demo-quarry-loop",
    name: "The Quarry Loop", suburb: "Coburg",
    lat: -37.7405, lng: 144.9702,
    priceFromCents: 0, discountPct: 0,
    offerText: "Free. 4km loop, flat the whole way",
    partnerTier: 1, moods: ["grass" as const], active: true,
  },
  {
    placeId: "questly-demo-morning-tide",
    name: "Morning Tide", suburb: "St Kilda",
    lat: -37.8677, lng: 144.9740,
    priceFromCents: 0, discountPct: 0,
    offerText: "Free. Bring a towel",
    partnerTier: 1, moods: ["grass" as const, "new" as const], active: true,
  },
  {
    placeId: "questly-demo-paper-lantern",
    name: "Paper Lantern", suburb: "Melbourne CBD",
    lat: -37.8118, lng: 144.9656,
    priceFromCents: 2200, discountPct: 30,
    offerText: "30% off the set menu before 7pm",
    partnerTier: 3, moods: ["treat" as const], active: true,
  },
  {
    placeId: "questly-demo-throwing-range",
    name: "The Throwing Range", suburb: "Collingwood",
    lat: -37.8016, lng: 144.9877,
    priceFromCents: 2500, discountPct: 20,
    offerText: "20% off a lane for groups of four or more",
    partnerTier: 2, moods: ["new" as const, "meet" as const], active: true,
  },
  {
    placeId: "questly-demo-glasshouse",
    name: "Glasshouse Studio", suburb: "Abbotsford",
    lat: -37.8036, lng: 144.9975,
    priceFromCents: 3500, discountPct: 25,
    offerText: "25% off a two-hour beginners class",
    partnerTier: 2, moods: ["new" as const], active: true,
  },
  {
    placeId: "questly-demo-fig-lane",
    name: "Fig Lane Gardens", suburb: "Kensington",
    lat: -37.7936, lng: 144.9302,
    priceFromCents: 0, discountPct: 0,
    offerText: "Free. Best bit is the far end",
    partnerTier: 1, moods: ["grass" as const], active: true,
  },
];

/**
 * Open rooms for the matchmaking lobby. Solo mode has a cold start on both
 * sides: nobody joins an empty list, so nobody is ever in the list. These four
 * break that, and every surface that shows them says they are demo rooms.
 */
const DEMO_ROOMS = [
  { code: "1001", mood: "grass" as const, host: "Priya", headcount: 4, budgetPerHeadCents: 0 },
  { code: "1002", mood: "meet" as const, host: "Dan", headcount: 6, budgetPerHeadCents: 3000 },
  { code: "1003", mood: "treat" as const, host: "Yuki", headcount: 4, budgetPerHeadCents: 5000 },
  { code: "1004", mood: "new" as const, host: "Marco", headcount: 5, budgetPerHeadCents: 3000 },
];

const MELBOURNE_TZ = "Australia/Melbourne";

/**
 * The zone's offset from UTC, in minutes, at a given instant -- derived from
 * `Intl` rather than a hard-coded +10/+11, because Melbourne observes daylight
 * saving and a constant is wrong for half the year.
 *
 * Formats the instant in `timeZone`, then reinterprets those same wall-clock
 * fields as UTC. The gap between that reinterpretation and the real instant is
 * exactly the zone's offset at that moment.
 */
function offsetMinutesFor(timeZone: string, epochMs: number): number {
  const parts: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(epochMs)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return (asIfUtc - epochMs) / 60_000;
}

/**
 * The next `hour:minute` wall-clock time in `timeZone`, strictly after `nowMs`,
 * returned as a UTC epoch millisecond timestamp.
 *
 * One pass assumes the zone's current offset also holds at the target time;
 * a second pass re-checks the offset at the guessed instant and corrects for
 * it, in case a daylight-saving transition falls between now and then.
 */
function nextLocalClockTime(
  timeZone: string,
  nowMs: number,
  hour: number,
  minute: number,
): number {
  const guessOnce = (offsetMin: number): number => {
    const wall = new Date(nowMs + offsetMin * 60_000);
    let guess =
      Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate(), hour, minute, 0, 0) -
      offsetMin * 60_000;
    if (guess < nowMs) guess += 24 * 60 * 60 * 1000;
    return guess;
  };

  const offset1 = offsetMinutesFor(timeZone, nowMs);
  let guess = guessOnce(offset1);

  const offset2 = offsetMinutesFor(timeZone, guess);
  if (offset2 !== offset1) guess = guessOnce(offset2);

  return guess;
}

/**
 * Tonight at 6:30 in Melbourne, so a seeded room never shows a past time.
 *
 * `setHours` sets local time, and Convex runs in UTC, so naively setting
 * 18:30 lands at 5:30am in Melbourne -- a demo would open on an empty-feeling
 * lobby with a room timed for dawn. Compute the real Melbourne evening
 * instead. If this runtime's ICU data doesn't carry the zone, fall back to
 * AEST (UTC+10, 8:30 UTC for 18:30 local) -- the best a runtime lacking the
 * zone can do. That guess is wrong by exactly the daylight-saving offset
 * from October to April, reading an hour early (5:30pm shown as 6:30pm), but
 * an hour off is a demo nobody notices; there is no honest way to do better
 * without the zone data this catch exists because we don't have.
 */
function tonight(): number {
  try {
    return nextLocalClockTime(MELBOURNE_TZ, Date.now(), 18, 30);
  } catch {
    const d = new Date();
    d.setUTCHours(8, 30, 0, 0);
    if (d.getTime() < Date.now()) d.setUTCDate(d.getUTCDate() + 1);
    return d.getTime();
  }
}

export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    let inserted = 0;
    let updated = 0;

    for (const partner of PARTNERS) {
      const existing = await ctx.db
        .query("venues")
        .withIndex("by_placeId", (q) => q.eq("placeId", partner.placeId))
        .unique();

      if (existing) {
        await ctx.db.patch(existing._id, partner);
        updated += 1;
      } else {
        await ctx.db.insert("venues", partner);
        inserted += 1;
      }
    }

    let rooms = 0;
    for (const demo of DEMO_ROOMS) {
      const existing = await ctx.db
        .query("rooms")
        .withIndex("by_code", (q) => q.eq("code", demo.code))
        .unique();
      if (existing) continue;

      const roomId = await ctx.db.insert("rooms", {
        hostUserId: `questly-demo-host-${demo.code}`,
        mood: demo.mood,
        headcount: demo.headcount,
        budgetPerHeadCents: demo.budgetPerHeadCents,
        whenAt: tonight(),
        centreLat: -37.8136,
        centreLng: 144.9631,
        radiusKm: 5,
        visibility: "open",
        status: "lobby",
        code: demo.code,
        demo: true,
      });

      // The session key is unguessable like any other, so the seeded host seat
      // cannot be taken over from the client.
      await ctx.db.insert("members", {
        roomId,
        name: demo.host,
        isHost: true,
        sessionKey: newSessionKey(),
        joinedAt: Date.now(),
      });
      rooms += 1;
    }

    return { inserted, updated, rooms };
  },
});
