/// <reference types="vite/client" />
import { registerComponents } from "./testHelpers";
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";

/**
 * Presence is additive and display-only, so these tests are as much about what
 * it must NOT be able to do as about what it shows. The last one is the whole
 * point of the design: every face in the room goes away, and the room still
 * matches on the roster it always used.
 */

const modules = import.meta.glob("../../convex/**/*.ts");
type T = TestConvex<typeof schema>;

const FUTURE = Date.now() + 7 * 24 * 60 * 60 * 1000;

const CREATE = {
  mood: "grass" as const,
  headcount: 4,
  budgetPerHeadCents: 0,
  whenAt: FUTURE,
  centreLat: -37.8,
  centreLng: 144.96,
  radiusKm: 5,
  visibility: "private" as const,
  hostName: "Bec",
};

/** A lobby with a host and one guest, and the keys to act as either. */
async function room(t: T) {
  const host = t.withIdentity({ subject: "u-host", name: "Bec" });
  const created = await host.mutation(api.rooms.create, CREATE);
  const guest = await t.mutation(api.rooms.join, { code: created.code, name: "Tam" });
  return { code: created.code, host: created.sessionKey, guest: guest.sessionKey };
}

test("a member's heartbeat puts their seat in the room's list", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { code, host, guest } = await room(t);

  const { roomToken } = await t.mutation(api.presence.heartbeat, {
    code, sessionKey: host, sessionId: "tab-1",
  });
  await t.mutation(api.presence.heartbeat, { code, sessionKey: guest, sessionId: "tab-2" });

  const list = await t.query(api.presence.list, { roomToken });
  expect(list.length).toBe(2);
  expect(list.every((entry) => entry.online)).toBe(true);

  // Keyed on the member row, so a guest -- who has no account at all -- is
  // present in the list exactly like the signed-in host.
  const seats = await t.run(async (ctx) => {
    const found = await ctx.db.query("members").collect();
    return found.map((m) => m._id as string);
  });
  expect(list.map((entry) => entry.userId).sort()).toEqual(seats.sort());
});

/**
 * The authorisation is the session key and nothing else, matching `swipes.cast`
 * and every other room mutation. No member id crosses the wire, so there is no
 * face in this room a stranger can light up.
 */
test("a non-member cannot heartbeat into a room", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { code } = await room(t);

  await expect(
    t.mutation(api.presence.heartbeat, { code, sessionKey: "not-a-key", sessionId: "tab-1" }),
  ).rejects.toThrow();
});

/**
 * Two tabs, one member. Closing one must not grey out the other, which is why
 * `sessionId` is per tab rather than reusing the member's session key.
 */
test("closing one tab leaves the member's other tab online", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { code, host } = await room(t);

  const first = await t.mutation(api.presence.heartbeat, {
    code, sessionKey: host, sessionId: "tab-1",
  });
  await t.mutation(api.presence.heartbeat, { code, sessionKey: host, sessionId: "tab-2" });

  await t.mutation(api.presence.disconnect, { sessionToken: first.sessionToken });

  const list = await t.query(api.presence.list, { roomToken: first.roomToken });
  expect(list.filter((entry) => entry.online).length).toBe(1);
});

/**
 * The guarantee the whole component is fenced off from. `waitingOn` and the
 * match denominator come from the roster, so a room whose every phone has gone
 * quiet still reaches unanimity on the swipes it was given.
 */
test("presence going away for everyone changes nothing about the room", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { code, host, guest } = await room(t);

  const questId = await t.run(async (ctx) => {
    const found = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    await ctx.db.patch(found!._id, { status: "swiping" });
    return await ctx.db.insert("quests", {
      roomId: found!._id, rank: 0, source: "places", placeId: "p0",
      title: "Only card", blurb: "", priceLabel: "Free", priceCents: 0,
      distanceKm: 1, discountPct: 0, score: 1, scoreBreakdown: {},
    });
  });

  const beat = await t.mutation(api.presence.heartbeat, {
    code, sessionKey: host, sessionId: "tab-1",
  });
  await t.mutation(api.presence.heartbeat, { code, sessionKey: guest, sessionId: "tab-2" });
  await t.mutation(api.presence.disconnect, { sessionToken: beat.sessionToken });

  await t.mutation(api.swipes.cast, { code, sessionKey: host, questId, dir: "yes" });
  const second = await t.mutation(api.swipes.cast, {
    code, sessionKey: guest, questId, dir: "yes",
  });

  expect(second).toEqual({ matched: true, questId });
  expect((await t.query(api.presence.list, { roomToken: beat.roomToken }))
    .filter((entry) => entry.online).length).toBe(1);
});
