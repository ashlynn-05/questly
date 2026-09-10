/// <reference types="vite/client" />
import { registerComponents } from "./testHelpers";
import { convexTest, type TestConvex } from "convex-test";
import { expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { EMBEDDING_MODEL } from "../../convex/lib/openai";

const modules = import.meta.glob("../../convex/**/*.ts");

/**
 * `TestConvex<typeof schema>`, NOT `ReturnType<typeof convexTest>`.
 *
 * The bare `ReturnType` drops the schema type parameter, so `ctx.db.insert`
 * inside `t.run` falls back to the generic data model and accepts ANY object
 * shape. This whole file's seeds went unchecked for it: a field that does not
 * exist on `rooms` compiled clean, so every one of these tests could have
 * stayed green while writing rows the real deployment would reject -- and the
 * first signal would have been a push failure or a runtime validator error.
 */
type Harness = TestConvex<typeof schema>;

/** The one search every room in these tests asks, unless it says otherwise. */
const SEARCH: {
  mood: "grass" | "meet" | "treat" | "new";
  budgetPerHeadCents: number;
  centreLat: number;
  centreLng: number;
  radiusKm: number;
} = {
  mood: "grass",
  budgetPerHeadCents: 0,
  centreLat: -37.81,
  centreLng: 144.96,
  radiusKm: 5,
};

type QuestSeed = {
  rank: number;
  placeId: string;
  source?: "partner" | "places";
  title?: string;
  blurb?: string;
  priceCents?: number;
  distanceKm?: number;
  discountPct?: number;
  score?: number;
  scoreBreakdown?: Record<string, number>;
};

/** A room that has already built a deck -- the one a later room may borrow from. */
async function donorRoom(
  t: Harness,
  opts: { builtAt: number; code?: string; quests?: QuestSeed[] } & Partial<typeof SEARCH>,
) {
  const { builtAt, code = "8888", quests = [{ rank: 0, placeId: "cached" }], ...search } = opts;
  return await t.run(async (ctx) => {
    const roomId = await ctx.db.insert("rooms", {
      ...SEARCH, ...search,
      hostUserId: "u1", headcount: 2, whenAt: 1,
      visibility: "private", status: "swiping", code, deckBuiltAt: builtAt,
    });
    for (const q of quests) {
      await ctx.db.insert("quests", {
        roomId,
        rank: q.rank,
        source: q.source ?? "places",
        placeId: q.placeId,
        title: q.title ?? "Cached",
        blurb: q.blurb ?? "",
        priceLabel: "Free",
        priceCents: q.priceCents ?? 0,
        distanceKm: q.distanceKm ?? 1,
        discountPct: q.discountPct ?? 0,
        score: q.score ?? 1,
        scoreBreakdown: q.scoreBreakdown ?? {},
      });
    }
    return roomId;
  });
}

/** A room in the lobby, asking for a deck of its own. */
const freshRoom = (t: Harness, code: string, search: Partial<typeof SEARCH> = {}) =>
  t.run(async (ctx) =>
    ctx.db.insert("rooms", {
      ...SEARCH, ...search,
      hostUserId: "u2", headcount: 2, whenAt: 1,
      visibility: "private", status: "lobby", code,
    }),
  );

/** Gives `freshRoom`'s host a session, so `api.deck.build` will talk to it. */
const withHost = (t: Harness, roomId: Id<"rooms">, userId = "u2") =>
  t.run(async (ctx) => {
    await ctx.db.insert("members", {
      roomId, name: "Host", userId, isHost: true, sessionKey: "hostkey", joinedAt: 1,
    });
  });

/**
 * Every network call this backend makes needs a key, and none is configured
 * under test, so a build that reaches the network throws before it gets there.
 * `fetch` is stubbed anyway: it turns "reached the network" into a distinct,
 * attributable failure instead of a missing-key message that could equally
 * come from somewhere else.
 */
function noNetwork() {
  const originalFetch = globalThis.fetch;
  const fetchMock = vi.fn(async () => {
    throw new Error("a borrowed deck must not touch the network");
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return { fetchMock, restore: () => { globalThis.fetch = originalFetch; } };
}

/**
 * The deck as it was STORED, in rank order.
 *
 * Reads the table rather than `rooms.get`. These tests are about which cached
 * rows a room reused and how it re-scored them, and `rooms.get` deliberately
 * projects none of `placeId`, `rank` or `score` -- no card renders them, and
 * how a venue was ranked is commercial detail. Asserting the cache through the
 * browser's projection would tie this file to a contract it is not testing.
 */
const deckOf = async (t: Harness, code: string) => {
  return await t.run(async (ctx) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    return await ctx.db
      .query("quests")
      .withIndex("by_room_rank", (q) => q.eq("roomId", room!._id))
      .order("asc")
      .collect();
  });
};

test("a matching recent deck is reused", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  await donorRoom(t, { builtAt: Date.now() });
  const roomId = await freshRoom(t, "8889");

  const cached = await t.query(internal.deck.recentDeck, { roomId, now: Date.now() });
  expect(cached).not.toBeNull();
  expect(cached![0].placeId).toBe("cached");
  expect(cached![0]).not.toHaveProperty("_id");
});

test("a stale deck is not reused", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  await donorRoom(t, { builtAt: Date.now() - 2 * 60 * 60 * 1000 });
  const roomId = await freshRoom(t, "8889");
  expect(await t.query(internal.deck.recentDeck, { roomId, now: Date.now() })).toBeNull();
});

test("a deck built for a different mood is not reused", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  await donorRoom(t, { builtAt: Date.now() });
  const roomId = await freshRoom(t, "8890", { mood: "treat" });
  expect(await t.query(internal.deck.recentDeck, { roomId, now: Date.now() })).toBeNull();
});

/**
 * The three tests above prove `recentDeck` itself is correct, but none of them
 * calls the action the app actually invokes -- `deck.build` -- so none would
 * notice if the cache check were wired out of `buildDeck` while `recentDeck`
 * stayed exported and correct. This one drives `api.deck.build`, the public
 * interface the deck-build button calls.
 *
 * What makes it load-bearing is the resolution at the top, not the `fetch`
 * assertion below it: with no `GOOGLE_MAPS_SERVER_KEY` configured under test,
 * `places.nearby` throws on the missing key before it ever reaches `fetch`, so
 * deleting the `if (cached)` short-circuit in `buildDeck` makes this action
 * reject and the test fail on `result`. The `fetch` assertion is a second,
 * weaker net: it is what would catch a future code path that HAS its key and
 * spends real quota on a deck it was handed for free.
 */
test("build reuses a cached deck instead of calling Places or OpenAI", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  await donorRoom(t, { builtAt: Date.now() });

  const roomId = await freshRoom(t, "8891");
  await withHost(t, roomId);

  const { fetchMock, restore } = noNetwork();
  try {
    const result = await t.action(api.deck.build, { code: "8891", sessionKey: "hostkey" });
    expect(result).toEqual({ deckSize: 1 });
    expect(fetchMock).not.toHaveBeenCalled();

    // The room really opened for swiping -- confirmed through the same query
    // the room screen subscribes to -- and it opened on the borrowed rows.
    const view = await t.query(api.rooms.get, { code: "8891", sessionKey: "hostkey" });
    expect(view!.room.status).toBe("swiping");
    expect((await deckOf(t, "8891")).map((q) => q.placeId)).toEqual(["cached"]);
  } finally {
    restore();
  }
});

/**
 * Mood was the only mismatched key component with a test. Radius and budget
 * both change which places were searched for in the first place -- radius is
 * the search circle, and a $0 budget swaps the whole type list for FREE_TYPES
 * -- so borrowing across either would hand a room a candidate list that
 * answers a different question.
 *
 * Asserted through `api.deck.build` rather than `recentDeck`: a miss must fall
 * through to a real build, which here means reaching for a Places key that is
 * not configured. The room going back to the lobby is the visible half of
 * that, and is what the host actually needs to be true.
 */
for (const { what, search } of [
  { what: "radius", search: { radiusKm: 8 } },
  { what: "budget", search: { budgetPerHeadCents: 4000 } },
]) {
  test(`a deck built for a different ${what} is not reused`, async () => {
    const t = convexTest(schema, modules);
  registerComponents(t);
    await donorRoom(t, { builtAt: Date.now() });

    const roomId = await freshRoom(t, "8892", search);
    expect(await t.query(internal.deck.recentDeck, { roomId, now: Date.now() })).toBeNull();

    await withHost(t, roomId);
    const { restore } = noNetwork();
    try {
      await expect(
        t.action(api.deck.build, { code: "8892", sessionKey: "hostkey" }),
      ).rejects.toThrow();
      const view = await t.query(api.rooms.get, { code: "8892", sessionKey: "hostkey" });
      expect(view!.room.status).toBe("lobby");
      expect(view!.quests).toEqual([]);
    } finally {
      restore();
    }
  });
}

/**
 * A room can carry `deckBuiltAt` and no quests -- its rows were deleted, or a
 * build set the timestamp for a deck that was later replaced. Borrowing an
 * empty candidate list would mean a room with no cards at all, so the lookup
 * skips it and keeps going rather than stopping at the first key match.
 */
test("a matching room with no quests is skipped, not borrowed from", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  await donorRoom(t, { builtAt: Date.now(), code: "8801", quests: [] });
  await donorRoom(t, {
    builtAt: Date.now() - 10 * 60 * 1000,
    code: "8802",
    quests: [{ rank: 0, placeId: "has-quests" }],
  });

  const roomId = await freshRoom(t, "8893");
  await withHost(t, roomId);

  const { restore } = noNetwork();
  try {
    await t.action(api.deck.build, { code: "8893", sessionKey: "hostkey" });
    expect((await deckOf(t, "8893")).map((q) => q.placeId)).toEqual(["has-quests"]);
  } finally {
    restore();
  }
});

/**
 * Freshest wins. Scan order used to decide this, and a plain table scan is
 * oldest-first, so a room building at 18:58 was handed the 18:00 deck -- two
 * minutes from expiry -- while a three-minute-old one sat right beside it.
 */
test("the most recent matching deck wins, not the oldest still-valid one", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  await donorRoom(t, {
    builtAt: Date.now() - 50 * 60 * 1000,
    code: "8803",
    quests: [{ rank: 0, placeId: "nearly-expired" }],
  });
  await donorRoom(t, {
    builtAt: Date.now() - 60 * 1000,
    code: "8804",
    quests: [{ rank: 0, placeId: "freshest" }],
  });

  const roomId = await freshRoom(t, "8894");
  await withHost(t, roomId);

  const { restore } = noNetwork();
  try {
    await t.action(api.deck.build, { code: "8894", sessionKey: "hostkey" });
    expect((await deckOf(t, "8894")).map((q) => q.placeId)).toEqual(["freshest"]);
  } finally {
    restore();
  }
});

/**
 * The one that matters. A borrowed deck is a borrowed CANDIDATE LIST, and the
 * ranking is redone for the room that asked -- serving the donor's order is
 * what silently turned the personalisation off.
 *
 * The donor here is seeded with a ranking that is wrong for the shared
 * constraints: its rank 0 is 4km out and not a mood match, its rank 1 is 500m
 * away and is one. Re-scored, `near` must come first. Anything that hands the
 * donor's `rank`/`score` straight through fails this test, including a revert
 * to the original `if (cached) return insertDeck(...)`.
 */
test("a borrowed deck is re-scored for the room that asked, not served as-is", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  await donorRoom(t, {
    builtAt: Date.now(),
    code: "8805",
    quests: [
      { rank: 0, placeId: "far", title: "Far", distanceKm: 4, score: 99, scoreBreakdown: { moodFit: 0 } },
      { rank: 1, placeId: "near", title: "Near", distanceKm: 0.5, score: 0, scoreBreakdown: { moodFit: 1.2 } },
    ],
  });

  const roomId = await freshRoom(t, "8895");
  await withHost(t, roomId);

  const { restore } = noNetwork();
  try {
    await t.action(api.deck.build, { code: "8895", sessionKey: "hostkey" });
    const quests = await deckOf(t, "8895");
    expect(quests.map((q) => q.placeId)).toEqual(["near", "far"]);
    expect(quests.map((q) => q.rank)).toEqual([0, 1]);
    // The donor's scores were fabrications; these are this room's own.
    expect(quests[0].score).not.toBe(0);
    expect(quests[1].score).not.toBe(99);
  } finally {
    restore();
  }
});

/**
 * The taste term is the differentiator the onboarding quiz exists to fill, and
 * it has to survive the cache or the quiz is decoration. There is no OpenAI key
 * under test, so the embedding call cannot succeed -- but whether it is
 * ATTEMPTED is the thing under test, and the documented fallback warning is how
 * the code says it tried. Before the cache was re-scored per room, a borrowed
 * deck never blended a vector and this warning could not appear at all.
 */
test("a borrowed deck still runs the room's own taste vectors", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  await donorRoom(t, { builtAt: Date.now(), code: "8806" });

  const roomId = await freshRoom(t, "8896");
  await withHost(t, roomId, "taster");
  await t.run(async (ctx) => {
    await ctx.db.insert("profiles", {
      userId: "taster", displayName: "Taster", tasteVector: [1, 0, 0],
      tasteSentence: "quiet parks", moodAffinity: {}, goals: [], createdAt: 1,
    });
  });

  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const { restore } = noNetwork();
  try {
    await t.action(api.deck.build, { code: "8896", sessionKey: "hostkey" });
    expect(warn).toHaveBeenCalledWith(
      "deck.build: taste re-rank skipped, ranking without it.",
      expect.anything(),
    );
    // The deck still lands: taste unavailable is a plainer ranking, never a
    // failed build.
    expect((await deckOf(t, "8896")).map((q) => q.placeId)).toEqual(["cached"]);
  } finally {
    restore();
    warn.mockRestore();
  }
});

/**
 * A partner's offer text IS its blurb, so a borrowed partner card is a live
 * commercial claim about a named venue. `deck.context` filters `venues` on
 * `active === true`; the cache has to honour that filter rather than route
 * around it, and it has to read the offer off the live row rather than the
 * copy frozen into the donor's deck an hour ago.
 */
test("a borrowed partner card is read off the live venue row", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  await donorRoom(t, {
    builtAt: Date.now(),
    code: "8807",
    quests: [
      { rank: 0, placeId: "p1", source: "partner", title: "Partner", blurb: "30% off, last hour" },
      { rank: 1, placeId: "x", title: "Ordinary" },
    ],
  });
  await t.run(async (ctx) => {
    await ctx.db.insert("venues", {
      placeId: "p1", name: "Partner", suburb: "CBD", lat: -37.81, lng: 144.96,
      priceFromCents: 0, discountPct: 30, offerText: "Today: 10% off", partnerTier: 3,
      moods: ["grass"], active: true,
    });
  });

  const roomId = await freshRoom(t, "8897");
  await withHost(t, roomId);

  const { restore } = noNetwork();
  try {
    await t.action(api.deck.build, { code: "8897", sessionKey: "hostkey" });
    const partner = (await deckOf(t, "8897")).find((q) => q.placeId === "p1");
    expect(partner!.blurb).toBe("Today: 10% off");
    expect(partner!.discountPct).toBe(30);
  } finally {
    restore();
  }
});

test("a withdrawn partner offer is dropped from a borrowed deck", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  await donorRoom(t, {
    builtAt: Date.now(),
    code: "8808",
    quests: [
      { rank: 0, placeId: "p1", source: "partner", title: "Partner", blurb: "30% off, last hour" },
      { rank: 1, placeId: "x", title: "Ordinary" },
    ],
  });
  await t.run(async (ctx) => {
    await ctx.db.insert("venues", {
      placeId: "p1", name: "Partner", suburb: "CBD", lat: -37.81, lng: 144.96,
      priceFromCents: 0, discountPct: 30, offerText: "30% off, last hour", partnerTier: 3,
      moods: ["grass"], active: false,
    });
  });

  const roomId = await freshRoom(t, "8898");
  await withHost(t, roomId);

  const { restore } = noNetwork();
  try {
    await t.action(api.deck.build, { code: "8898", sessionKey: "hostkey" });
    const quests = await deckOf(t, "8898");
    expect(quests.map((q) => q.placeId)).toEqual(["x"]);
    expect(quests.map((q) => q.blurb)).not.toContain("30% off, last hour");
  } finally {
    restore();
  }
});

// --- attrition: a hit that comes back gutted is not a hit --------------------
//
// Borrowed partner cards are re-read off the live venue rows, so a donor deck
// can arrive much thinner than it left: eight withdrawn offers out of nine
// leaves a "personalised deck" of one card, which the room matches or exhausts
// the instant it opens. That reads as a broken build, not a fast one.

/** A donor whose cards are all partner rows, so their fate follows the venues. */
async function partnerDonor(t: Harness, code: string, active: number, inactive: number) {
  const quests: QuestSeed[] = [];
  for (let i = 0; i < active + inactive; i++) {
    quests.push({ rank: i, placeId: `pd-${i}`, source: "partner", title: `Partner ${i}` });
  }
  await donorRoom(t, { builtAt: Date.now(), code, quests });
  await t.run(async (ctx) => {
    for (let i = 0; i < active + inactive; i++) {
      await ctx.db.insert("venues", {
        placeId: `pd-${i}`, name: `Partner ${i}`, suburb: "CBD", lat: -37.81, lng: 144.96,
        priceFromCents: 0, discountPct: 20, offerText: "20% off", partnerTier: 2,
        moods: ["grass"], active: i < active,
      });
    }
  });
}

test("a borrowed deck gutted by withdrawn offers is rebuilt instead of served", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await partnerDonor(t, "8810", 1, 5); // one of six survives

  const roomId = await freshRoom(t, "8811");
  await withHost(t, roomId);

  const originalFetch = globalThis.fetch;
  // The rebuild is attempted for real, which is the whole point -- and with
  // Google down it fails rather than quietly serving the one card.
  globalThis.fetch = vi.fn(async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;
  try {
    await expect(
      t.action(api.deck.build, { code: "8811", sessionKey: "hostkey" }),
    ).rejects.toMatchObject({ data: { code: "PLACES_UNAVAILABLE" } });
  } finally {
    globalThis.fetch = originalFetch;
  }

  // No one-card deck was written, and the room is back where it can try again.
  const room = await t.run(async (ctx) => ctx.db.get(roomId));
  expect(room!.status).toBe("lobby");
  expect(await t.run(async (ctx) => ctx.db.query("quests").collect())).toHaveLength(6);
});

// The floor is relative to what was BORROWED, not to DECK_SIZE. A donor that
// only ever had a few cards is a thin neighbourhood, not attrition -- and a
// full rebuild there would spend a Places call and a batch of blurbs to be
// handed the same few places back.
test("a thin donor that loses nothing is still a hit", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  await partnerDonor(t, "8812", 2, 0); // both survive

  const roomId = await freshRoom(t, "8813");
  await withHost(t, roomId);

  const { restore } = noNetwork();
  try {
    await t.action(api.deck.build, { code: "8813", sessionKey: "hostkey" });
    expect(await deckOf(t, "8813")).toHaveLength(2);
  } finally {
    restore();
  }
});

/**
 * The cache path writes through `insertDeck` -> `internal.deck.insert`, which
 * is the single writer for both paths and the single place `holdsLease` is
 * checked. Nothing else asserted that, so a later "optimisation" that inserted
 * quest rows directly -- or dropped the token from the call -- would pass every
 * other test in this file while a stalled build overwrote a deck the room was
 * already swiping and orphaned every swipe cast against it.
 *
 * Staged as the real interleaving: build #1 claims the room and stalls past
 * STALE_BUILD_MS; build #2 takes the claim, borrows a deck and finishes; build
 * #1 finally comes back and tries to write.
 */
test("a superseded build cannot overwrite a deck built from cache", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  await donorRoom(t, { builtAt: Date.now(), code: "8809" });

  const roomId = await freshRoom(t, "8899");
  await withHost(t, roomId);
  await t.run(async (ctx) => {
    await ctx.db.patch(roomId, {
      status: "building",
      buildStartedAt: Date.now() - 3 * 60 * 1000,
      buildToken: "stalled-build-1",
    });
  });

  const { restore } = noNetwork();
  try {
    // Build #2 takes the stale claim and finishes off the cache.
    await t.action(api.deck.build, { code: "8899", sessionKey: "hostkey" });
    const view = await t.query(api.rooms.get, { code: "8899", sessionKey: "hostkey" });
    expect(view!.room.status).toBe("swiping");
    expect((await deckOf(t, "8899")).map((q) => q.placeId)).toEqual(["cached"]);

    // Build #1 wakes up holding a token the room no longer honours.
    const wrote = await t.mutation(internal.deck.insert, {
      roomId,
      token: "stalled-build-1",
      quests: [{
        rank: 0, source: "places", placeId: "from-the-stalled-build", title: "Stale",
        blurb: "", priceLabel: "Free", priceCents: 0, distanceKm: 1, discountPct: 0,
        score: 1, scoreBreakdown: {},
      }],
    });
    expect(wrote).toBeNull();
    expect((await deckOf(t, "8899")).map((q) => q.placeId)).toEqual(["cached"]);
  } finally {
    restore();
  }
});

/**
 * The deck cache borrows the candidates but never the ranking, so a borrowing
 * room still runs `rankByTaste` over the donor's cards -- and what a venue is
 * does not depend on which room is looking at it.
 *
 * The two tests above reach `deck.build` with no signed-in member, so
 * `blend(vectors)` is undefined and the embedding call is skipped entirely:
 * neither of them would notice if the taste path were spending quota. This one
 * gives the host a taste vector, which turns the embedding call on.
 *
 * The seeded rows deliberately carry NO relation to the words on the borrowed
 * cards. That is the regression this encodes: keyed on the card text, a borrow
 * misses every places card, because a full build embeds the Google summary
 * (`writeBlurbs` runs after the ranking) and a borrow embeds the finished LLM
 * blurb. Keyed on the place, the same venue is the same venue either way.
 *
 * The ordering assertion is the load-bearing half. `rankByTaste` catches its
 * own failures and falls back to the untasted order, so a cache that returned
 * nothing would leave this room on the donor's order with a silent warning.
 * Alpha and Beta score identically on every other term, so only taste can move
 * Beta in front, and only a cache hit can supply taste without a network call.
 */
test("a borrowed deck re-ranks on cached embeddings and spends no quota", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  await donorRoom(t, {
    builtAt: Date.now(),
    quests: [
      { rank: 0, placeId: "a", title: "Alpha", blurb: "a blurb nobody ever embedded" },
      { rank: 1, placeId: "b", title: "Beta", blurb: "nor this one" },
    ],
  });

  const roomId = await freshRoom(t, "8892");
  await withHost(t, roomId);
  await t.run(async (ctx) => {
    await ctx.db.insert("profiles", {
      userId: "u2",
      displayName: "Host",
      tasteVector: [1, 0],
      tasteSentence: "likes the first axis",
      moodAffinity: {},
      createdAt: 1,
    });
    await ctx.db.insert("venueEmbeddings", {
      model: EMBEDDING_MODEL, placeId: "a", vector: [0, 1],
    });
    await ctx.db.insert("venueEmbeddings", {
      model: EMBEDDING_MODEL, placeId: "b", vector: [1, 0],
    });
  });

  const { fetchMock, restore } = noNetwork();
  try {
    expect(await t.action(api.deck.build, { code: "8892", sessionKey: "hostkey" }))
      .toEqual({ deckSize: 2 });
    expect(fetchMock).not.toHaveBeenCalled();

    const quests = await deckOf(t, "8892");
    expect(quests.map((q) => q.placeId)).toEqual(["b", "a"]);
    expect(quests[0].scoreBreakdown.tasteSimilarity).toBeGreaterThan(0);
  } finally {
    restore();
  }
});

/**
 * The cache's whole contract is "same venue, same model, one row". Two rooms
 * building the same shortlist at the same instant race to write the same
 * place, which is why `saveEmbeddings` skips rather than throws -- a second
 * write must be a no-op, not a lost batch.
 *
 * The model is part of the key, not a column beside it: a rotation must read
 * as a miss. A cached 1536-wide vector scored against a 3072-wide taste vector
 * does not fail, it returns 0 from `cosine`, which would quietly demote every
 * already-cached venue below every fresh one.
 */
test("the embedding cache answers by place and model, and writes each one once", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const model = EMBEDDING_MODEL;

  expect(await t.query(internal.deck.cachedEmbeddings, { model, placeIds: ["a"] }))
    .toEqual([null]);

  await t.mutation(internal.deck.saveEmbeddings, {
    model, entries: [{ placeId: "a", vector: [0, 1] }],
  });
  await t.mutation(internal.deck.saveEmbeddings, {
    model, entries: [{ placeId: "a", vector: [9, 9] }],
  });

  expect(await t.query(internal.deck.cachedEmbeddings, { model, placeIds: ["a", "b"] }))
    .toEqual([[0, 1], null]);
  expect(await t.query(internal.deck.cachedEmbeddings, { model: "some-other-model", placeIds: ["a"] }))
    .toEqual([null]);
  expect(await t.run(async (ctx) => (await ctx.db.query("venueEmbeddings").collect()).length))
    .toBe(1);
});
