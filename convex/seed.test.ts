/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { PARTNERS } from "./seed";

const modules = import.meta.glob("./**/*.ts");

test("seeding twice does not duplicate venues", async () => {
  const t = convexTest(schema, modules);
  const first = await t.mutation(internal.seed.run, {});
  const second = await t.mutation(internal.seed.run, {});
  expect(first.inserted).toBe(PARTNERS.length);
  expect(second.inserted).toBe(0);

  const venues = await t.run(async (ctx) => ctx.db.query("venues").collect());
  const ids = venues.map((v) => v.placeId);
  expect(new Set(ids).size).toBe(ids.length);
});

test("every mood has at least two partner venues, so no deck is empty", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.run, {});
  const venues = await t.run(async (ctx) => ctx.db.query("venues").collect());
  for (const mood of ["grass", "meet", "treat", "new"] as const) {
    expect(venues.filter((v) => v.moods.includes(mood)).length).toBeGreaterThanOrEqual(2);
  }
});

test("every seeded venue is inside greater Melbourne", async () => {
  for (const p of PARTNERS) {
    expect(p.lat).toBeGreaterThan(-38.5);
    expect(p.lat).toBeLessThan(-37.5);
    expect(p.lng).toBeGreaterThan(144.5);
    expect(p.lng).toBeLessThan(145.5);
  }
});

test("free-mood venues are actually free, so a $0 room has stock", async () => {
  const free = PARTNERS.filter((p) => p.priceFromCents === 0);
  expect(free.length).toBeGreaterThanOrEqual(2);
});

test("every mood gets a seeded open room, so matchmaking is never empty", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.run, {});
  for (const mood of ["grass", "meet", "treat", "new"] as const) {
    const open = await t.query(api.rooms.openRooms, { mood });
    expect(open.length).toBeGreaterThanOrEqual(1);
  }
});

// A seeded room used to arrive with a fake host already sitting in it, which
// meant the demo rooms on the browse screen were advertising a person who does
// not exist and were counted towards unanimity forever. They now ship with an
// empty roster and an unclaimed host seat: the first real person through the
// door takes it, so the room is genuinely joinable and nobody is invented.
test("every seeded room is flagged as a demo and starts with nobody in it", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.run, {});
  const open = await t.query(api.rooms.openRooms, { mood: "grass" });
  expect(open.length).toBeGreaterThanOrEqual(1);
  expect(open.every((r) => r.demo)).toBe(true);
  expect(open.every((r) => r.memberCount === 0)).toBe(true);
});

test("the first person to join a seeded room takes the empty host seat", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.run, {});
  const [room] = await t.query(api.rooms.openRooms, { mood: "grass" });

  const first = await t.mutation(api.rooms.join, { code: room.code, name: "Tam" });
  const second = await t.mutation(api.rooms.join, { code: room.code, name: "Bec" });

  const roster = await t.run(async (ctx) => {
    const doc = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", room.code))
      .unique();
    if (!doc) throw new Error("seeded room vanished");
    return await ctx.db
      .query("members")
      .withIndex("by_room", (q) => q.eq("roomId", doc._id))
      .collect();
  });

  expect(roster.length).toBe(2);
  const tam = roster.find((m) => m.sessionKey === first.sessionKey);
  const bec = roster.find((m) => m.sessionKey === second.sessionKey);
  expect(tam?.isHost).toBe(true);
  expect(bec?.isHost).toBe(false);
});

test("seeding twice does not duplicate the rooms either", async () => {
  const t = convexTest(schema, modules);
  const first = await t.mutation(internal.seed.run, {});
  const second = await t.mutation(internal.seed.run, {});
  expect(first.rooms).toBe(4);
  expect(second.rooms).toBe(0);
});

// The bug this guards against: `tonight()` used `Date#setHours`, which sets
// LOCAL time -- and Convex runs in UTC, so "18:30" landed at 5:30am in
// Melbourne. A test that only checks the timestamp is in the future would
// have passed on that broken version; this one reads the wall-clock time back
// out in the actual zone and checks it says what it should.
test("seeded rooms are timed for 6:30pm in Melbourne, not 6:30pm UTC", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.run, {});
  const rooms = await t.run(async (ctx) =>
    ctx.db
      .query("rooms")
      .withIndex("by_visibility_status", (q) => q.eq("visibility", "open").eq("status", "lobby"))
      .collect(),
  );
  expect(rooms.length).toBeGreaterThan(0);

  for (const room of rooms) {
    const label = new Date(room.whenAt).toLocaleTimeString("en-AU", {
      timeZone: "Australia/Melbourne",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    expect(label.toLowerCase()).toBe("6:30 pm");
    // And it really is in the future -- both properties matter; neither one
    // alone would have caught the original bug.
    expect(room.whenAt).toBeGreaterThan(Date.now());
  }
});
