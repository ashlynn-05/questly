/// <reference types="vite/client" />
import { registerComponents } from "./testHelpers";

import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";

const modules = import.meta.glob("../../convex/**/*.ts");

const FUTURE = Date.now() + 7 * 24 * 60 * 60 * 1000;

/**
 * A room written before the taxonomy changed. The mood is deliberately cast:
 * the retired ids are not in `Mood` any more, which is the whole point -- these
 * rows exist and nothing in the type system knows it.
 */
function legacyRoom(mood: string, code: string) {
  return {
    hostUserId: "legacy-host",
    code,
    mood: mood as "grass",
    headcount: 4,
    budgetPerHeadCents: 3000,
    radiusKm: 5,
    centreLat: -37.8136,
    centreLng: 144.9631,
    whenAt: FUTURE,
    status: "lobby" as const,
    visibility: "private" as const,
  };
}

function legacyVenue(moods: string[], placeId: string) {
  return {
    placeId,
    name: "A venue that predates the change",
    suburb: "Fitzroy",
    lat: -37.7986,
    lng: 144.9784,
    priceFromCents: 1400,
    discountPct: 10,
    offerText: "10% off",
    partnerTier: 1,
    moods: moods as Array<"grass">,
    active: true,
  };
}

test("the backfill rewrites every retired room mood and leaves the rest alone", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);

  await t.run(async (ctx) => {
    await ctx.db.insert("rooms", legacyRoom("meet", "9001"));
    await ctx.db.insert("rooms", legacyRoom("treat", "9002"));
    await ctx.db.insert("rooms", legacyRoom("new", "9003"));
    await ctx.db.insert("rooms", legacyRoom("grass", "9004"));
    await ctx.db.insert("rooms", legacyRoom("hangout", "9005"));
  });

  await t.mutation(internal.migrations.run, { fn: "migrations:backfillMoods" });

  const byCode = await t.run(async (ctx) => {
    const rooms = await ctx.db.query("rooms").collect();
    return Object.fromEntries(rooms.map((r) => [r.code, r.mood]));
  });

  expect(byCode).toEqual({
    "9001": "hangout",
    "9002": "hangout",
    "9003": "sidequest",
    "9004": "grass",
    "9005": "hangout",
  });
});

test("a venue tagged with both retired ids that map to one is not tagged twice", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);

  await t.run(async (ctx) => {
    await ctx.db.insert("venues", legacyVenue(["meet", "treat"], "legacy-both"));
    await ctx.db.insert("venues", legacyVenue(["grass", "new"], "legacy-mixed"));
    await ctx.db.insert("venues", legacyVenue(["grass"], "legacy-clean"));
  });

  await t.mutation(internal.migrations.run, { fn: "migrations:backfillVenueMoods" });

  const byPlaceId = await t.run(async (ctx) => {
    const venues = await ctx.db.query("venues").collect();
    return Object.fromEntries(venues.map((venue) => [venue.placeId, venue.moods]));
  });

  expect(byPlaceId).toEqual({
    "legacy-both": ["hangout"],
    "legacy-mixed": ["grass", "sidequest"],
    "legacy-clean": ["grass"],
  });
});

test("running the backfill twice writes nothing the second time", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);

  await t.run(async (ctx) => {
    await ctx.db.insert("rooms", legacyRoom("meet", "9101"));
  });

  await t.mutation(internal.migrations.run, { fn: "migrations:backfillMoods" });
  const first = await t.run(async (ctx) => {
    const room = await ctx.db.query("rooms").unique();
    return { mood: room?.mood, at: room?._creationTime };
  });

  await t.mutation(internal.migrations.run, { fn: "migrations:backfillMoods" });
  const second = await t.run(async (ctx) => {
    const room = await ctx.db.query("rooms").unique();
    return { mood: room?.mood, at: room?._creationTime };
  });

  expect(second).toEqual(first);
  expect(second.mood).toBe("hangout");
});
