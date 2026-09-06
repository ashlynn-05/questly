/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function roomWithDeck(t: ReturnType<typeof convexTest>, builtAt: number) {
  return await t.run(async (ctx) => {
    const roomId = await ctx.db.insert("rooms", {
      hostUserId: "u1", mood: "grass", headcount: 2, budgetPerHeadCents: 0,
      whenAt: 1, centreLat: -37.81, centreLng: 144.96, radiusKm: 5,
      visibility: "private", status: "swiping", code: "8888", deckBuiltAt: builtAt,
    });
    await ctx.db.insert("quests", {
      roomId, rank: 0, source: "places", placeId: "cached", title: "Cached", blurb: "",
      priceLabel: "Free", priceCents: 0, distanceKm: 1, discountPct: 0, score: 1, scoreBreakdown: {},
    });
    return roomId;
  });
}

const freshRoom = (t: ReturnType<typeof convexTest>, mood: "grass" | "treat", code: string) =>
  t.run(async (ctx) =>
    ctx.db.insert("rooms", {
      hostUserId: "u2", mood, headcount: 2, budgetPerHeadCents: 0,
      whenAt: 1, centreLat: -37.81, centreLng: 144.96, radiusKm: 5,
      visibility: "private", status: "lobby", code,
    }),
  );

test("a matching recent deck is reused", async () => {
  const t = convexTest(schema, modules);
  await roomWithDeck(t, Date.now());
  const roomId = await freshRoom(t, "grass", "8889");

  const cached = await t.query(internal.deck.recentDeck, { roomId });
  expect(cached).not.toBeNull();
  expect(cached![0].placeId).toBe("cached");
  expect(cached![0]).not.toHaveProperty("_id");
});

test("a stale deck is not reused", async () => {
  const t = convexTest(schema, modules);
  await roomWithDeck(t, Date.now() - 2 * 60 * 60 * 1000);
  const roomId = await freshRoom(t, "grass", "8889");
  expect(await t.query(internal.deck.recentDeck, { roomId })).toBeNull();
});

test("a deck built for a different mood is not reused", async () => {
  const t = convexTest(schema, modules);
  await roomWithDeck(t, Date.now());
  const roomId = await freshRoom(t, "treat", "8890");
  expect(await t.query(internal.deck.recentDeck, { roomId })).toBeNull();
});

/**
 * The three tests above prove `recentDeck` itself is correct, but none of them
 * calls the action the app actually invokes -- `deck.build` -- so none would
 * notice if the cache check were wired out of `buildDeck` while `recentDeck`
 * stayed exported and correct. This one drives `api.deck.build`, the public
 * interface the "Ask Claude" / deck-build button calls, with `fetch` stubbed
 * to throw: if the build ever reaches Places or OpenAI this test fails, which
 * is exactly what would happen the moment someone removes the `if (cached)`
 * short-circuit in `buildDeck` -- the room still has no Google or OpenAI key
 * configured, so the very first network call throws.
 */
test("build reuses a cached deck instead of calling Places or OpenAI", async () => {
  const t = convexTest(schema, modules);
  await roomWithDeck(t, Date.now());

  const roomId = await freshRoom(t, "grass", "8891");
  await t.run(async (ctx) => {
    await ctx.db.insert("members", {
      roomId, name: "Host", userId: "u2", isHost: true, sessionKey: "hostkey", joinedAt: 1,
    });
  });

  const originalFetch = globalThis.fetch;
  const fetchMock = vi.fn(async () => {
    throw new Error("a cached deck must not touch the network");
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  try {
    const result = await t.action(api.deck.build, { code: "8891", sessionKey: "hostkey" });
    expect(result).toEqual({ deckSize: 1 });
    expect(fetchMock).not.toHaveBeenCalled();

    // Confirmed through the same query the room screen subscribes to, not by
    // reaching into ctx.db.
    const view = await t.query(api.rooms.get, { code: "8891", sessionKey: "hostkey" });
    expect(view!.quests.map((q) => q.placeId)).toEqual(["cached"]);
    expect(view!.room.status).toBe("swiping");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
