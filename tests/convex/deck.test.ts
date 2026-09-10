/// <reference types="vite/client" />
import { registerComponents } from "./testHelpers";
import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import type { Id } from "../../convex/_generated/dataModel";
import { DECK_SIZE, FREE_TYPES, MOOD_TYPES, type Mood } from "../../convex/lib/deck/scoring";
import {
  VENUE_CATALOG_CEILING,
  VENUE_PAGE_MAX_ROWS,
  VENUE_PAGE_MAX_BYTES,
  VENUE_PAGE_SIZE,
} from "../../convex/lib/deck/venues";

const modules = import.meta.glob("../../convex/**/*.ts");

const GOOGLE_KEY = "test-google-maps-key";
const OPENAI_KEY = "test-openai-key";

const PLACES_URL = "https://places.googleapis.com/v1/places:searchNearby";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";

/**
 * Every user-facing throw must arrive as a `ConvexError` carrying a stable
 * `code`: a plain `Error`'s message is redacted to "Server Error" in
 * production, so prose alone is not a contract the browser can rely on.
 */
async function expectUserError(promise: Promise<unknown>, code: string, messagePattern: RegExp) {
  await expect(promise).rejects.toBeInstanceOf(ConvexError);
  await expect(promise).rejects.toMatchObject({
    data: { code, message: expect.stringMatching(messagePattern) },
  });
}

async function roomWithPartner(
  t: TestConvex<typeof schema>,
  over: { mood?: Mood; status?: "lobby" | "swiping" } = {},
) {
  return await t.run(async (ctx) => {
    const roomId = await ctx.db.insert("rooms", {
      hostUserId: "u1",
      mood: over.mood ?? "hangout",
      headcount: 4,
      budgetPerHeadCents: 4000,
      whenAt: 1_800_000_000_000,
      centreLat: -37.8,
      centreLng: 144.96,
      radiusKm: 5,
      visibility: "private",
      status: over.status ?? "lobby",
      code: "2222",
    });
    await ctx.db.insert("members", {
      roomId, name: "Bec", userId: "u1", isHost: true, sessionKey: "hostkey", joinedAt: 1,
    });
    await ctx.db.insert("members", {
      roomId, name: "Sam", userId: undefined, isHost: false, sessionKey: "guestkey", joinedAt: 2,
    });
    await ctx.db.insert("venues", {
      placeId: "partner-1", name: "The Long Weekend", suburb: "Carlton",
      lat: -37.801, lng: 144.967, priceFromCents: 1400, discountPct: 25,
      offerText: "25% off midweek", partnerTier: 3, moods: ["hangout"], active: true,
    });
    // A venue for a different mood, which must not appear in a treat room.
    await ctx.db.insert("venues", {
      placeId: "partner-2", name: "Second Wind", suburb: "Fitzroy",
      lat: -37.8, lng: 144.98, priceFromCents: 0, discountPct: 0,
      offerText: "", partnerTier: 1, moods: ["grass"], active: true,
    });
    return roomId;
  });
}

/** One card in the room, so it counts as a deck that is actually being played. */
async function seedQuest(t: TestConvex<typeof schema>, roomId: Id<"rooms">) {
  return await t.run(async (ctx) =>
    ctx.db.insert("quests", {
      roomId, rank: 0, source: "partner", placeId: "partner-1",
      title: "The Long Weekend", blurb: "Carlton", priceLabel: "$14",
      priceCents: 1400, distanceKm: 0.2, discountPct: 25,
      score: 1, scoreBreakdown: {},
    }),
  );
}

/** Take the room's build lease, the way `build` does before it writes. */
async function lease(t: TestConvex<typeof schema>, roomId: Id<"rooms">): Promise<string> {
  const token = await t.mutation(internal.deck.markBuilding, { roomId });
  if (token === null) throw new Error("expected to take the build lease");
  return token;
}

const quest = (over: Record<string, unknown>) => ({
  rank: 0, source: "places" as const, placeId: "p", title: "T", blurb: "b",
  priceLabel: "Free", priceCents: 0, distanceKm: 1, discountPct: 0,
  score: 1, scoreBreakdown: {}, ...over,
});

/**
 * Six restaurants (the room mood's own Places type) and six coffee shops (a
 * type Places surfaces under a restaurant query but the mood never asked for).
 * That split is the whole point: it is what makes `moodFit` discriminate.
 */
// `priceLevel` is an override because Google frequently sends no price signal
// at all, and "no signal" is a different case from every band it does send.
// Pass `null` to model a place Google would not price.
const rawPlace = (
  id: string,
  primaryType: string,
  i: number,
  priceLevel: string | null = "PRICE_LEVEL_INEXPENSIVE",
) => ({
  id,
  displayName: { text: `Place ${id}` },
  formattedAddress: `${i} Smith St, Fitzroy VIC`,
  location: { latitude: -37.8, longitude: 144.96 + i * 0.001 },
  primaryType,
  primaryTypeDisplayName: { text: primaryType },
  types: [primaryType, "restaurant"],
  ...(priceLevel === null ? {} : { priceLevel }),
  editorialSummary: { text: `A summary for ${id}.` },
  photos: [{ name: `places/${id}/photos/photo-${id}` }],
});

const PLACES_BODY = {
  places: [
    ...Array.from({ length: 6 }, (_, i) => rawPlace(`r${i}`, "restaurant", i)),
    ...Array.from({ length: 6 }, (_, i) => rawPlace(`c${i}`, "coffee_shop", i)),
  ],
};

// Blurbs for every card the deck can hold, out of order on purpose: the merge
// is by index, never by position in the model's reply.
const OPENAI_BODY = {
  choices: [
    {
      message: {
        content: JSON.stringify({
          blurbs: Array.from({ length: DECK_SIZE }, (_, i) => ({
            i: DECK_SIZE - 1 - i,
            text: `  blurb ${DECK_SIZE - 1 - i}  `,
          })),
        }),
      },
    },
  ],
};

/**
 * Two-dimensional stand-in vectors, chosen so taste and mood pull in opposite
 * directions: a coffee shop scores cosine +1 against the room's taste and a
 * restaurant -1. The gap is 2 x 1.1 = 2.2, comfortably more than the 1.2 that
 * moodFit gives the restaurants -- so if the re-rank runs at all, the order
 * visibly flips, and if it silently does not, the test fails.
 */
const TASTE_VECTOR = [1, 0];
const vectorFor = (input: string) =>
  input.startsWith("Place c") ? [1, 0] : input.startsWith("Place r") ? [-1, 0] : [0, 1];

/**
 * The openai SDK asks for base64-encoded embeddings by default and decodes them
 * through a Float32Array (node_modules/openai/lib/embeddings.js), so the stub
 * must speak that wire format. A plain numeric array decodes to `[]` in
 * silence, which is how the first version of this test "passed" while the
 * re-rank it claimed to prove was doing nothing at all.
 */
const toBase64Float32 = (vec: number[]) =>
  Buffer.from(new Float32Array(vec).buffer).toString("base64");

const embeddingsFor = (init: RequestInit) => {
  const inputs = JSON.parse(init.body as string).input as string[];
  // Returned out of order on purpose: callers pair vectors with inputs by
  // index, and nothing should depend on the endpoint's ordering.
  return {
    object: "list",
    model: "text-embedding-3-small",
    usage: { prompt_tokens: 1, total_tokens: 1 },
    data: inputs
      .map((input, index) => ({
        object: "embedding",
        index,
        embedding: toBase64Float32(vectorFor(input)),
      }))
      .reverse(),
  };
};

let fetchMock: ReturnType<typeof vi.fn>;
const originalFetch = globalThis.fetch;

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  process.env.GOOGLE_MAPS_SERVER_KEY = GOOGLE_KEY;
  process.env.OPENAI_API_KEY = OPENAI_KEY;
  fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    if (String(url) === PLACES_URL) return json(PLACES_BODY);
    if (String(url) === OPENAI_URL) return json(OPENAI_BODY);
    if (String(url) === EMBEDDINGS_URL) return json(embeddingsFor(init));
    throw new Error(`Unexpected fetch to ${url}`);
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  delete process.env.GOOGLE_MAPS_SERVER_KEY;
  delete process.env.OPENAI_API_KEY;
});

const callBody = (url: string) => {
  const call = fetchMock.mock.calls.find(([u]) => String(u) === url);
  if (!call) throw new Error(`No fetch to ${url}`);
  return JSON.parse(call[1].body as string);
};

test("DECK_SIZE is nine", () => {
  expect(DECK_SIZE).toBe(9);
});

test("deck.context returns the room and only the partners for its mood", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const roomId = await roomWithPartner(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("profiles", {
      userId: "u1", displayName: "Bec", tasteVector: [0.1, 0.2],
      tasteSentence: "likes food", moodAffinity: {}, createdAt: 1,
    });
  });

  const out = await t.query(internal.deck.context, { roomId });
  expect(out.room.code).toBe("2222");
  expect(out.partners.map((p) => p.placeId)).toEqual(["partner-1"]);
  // The guest member has no userId, so contributes no vector.
  expect(out.vectors).toEqual([[0.1, 0.2]]);
  // Nobody has said anything about "hangout", so the room is neutral about it.
  expect(out.moodAffinity).toBe(0);
});

// The quiz's mood answers were stored and read by nothing. They now reach the
// ranker, and this is the seam where they enter it.
test("deck.context blends the members' appetite for tonight's mood", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const roomId = await roomWithPartner(t); // a "hangout" room
  await t.run(async (ctx) => {
    // The host is keen on a hang-out; the second signed-in member is not.
    await ctx.db.insert("profiles", {
      userId: "u1", displayName: "Bec", tasteVector: [],
      tasteSentence: "", moodAffinity: { grass: 1, sidequest: 0, hangout: 2 }, createdAt: 1,
    });
    await ctx.db.insert("profiles", {
      userId: "u3", displayName: "Kit", tasteVector: [],
      tasteSentence: "", moodAffinity: { grass: 0, sidequest: 0, hangout: 0 }, createdAt: 1,
    });
    await ctx.db.insert("members", {
      roomId, name: "Kit", userId: "u3", isHost: false, sessionKey: "kitkey", joinedAt: 3,
    });
  });

  const out = await t.query(internal.deck.context, { roomId });
  // The mean of the two who answered. The guest, who told us nothing, is not
  // averaged in as indifference.
  expect(out.moodAffinity).toBe(1);
});

test("build reads an eligible venue after the first bounded page", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const roomId = await roomWithPartner(t);
  await t.run(async (ctx) => {
    for (let i = 0; i < VENUE_PAGE_SIZE - 1; i++) {
      await ctx.db.insert("venues", {
        placeId: `filler-${i}`, name: `Filler ${i}`, suburb: "CBD",
        lat: -37.8, lng: 144.96, priceFromCents: 2000, discountPct: 0,
        offerText: "Filler", partnerTier: 1, moods: ["hangout"], active: true,
      });
    }
    await ctx.db.insert("venues", {
      placeId: "late-top", name: "Late Top", suburb: "CBD",
      lat: -37.8, lng: 144.96, priceFromCents: 0, discountPct: 40,
      offerText: "Late offer", partnerTier: 3, moods: ["hangout"], active: true,
    });
    await ctx.db.insert("venues", {
      placeId: "late-inactive", name: "Late Inactive", suburb: "CBD",
      lat: -37.8, lng: 144.96, priceFromCents: 0, discountPct: 40,
      offerText: "Withdrawn", partnerTier: 3, moods: ["hangout"], active: false,
    });
  });

  const firstPage = await t.query(internal.deck.activeVenuePage, {
    paginationOpts: {
      numItems: VENUE_PAGE_SIZE,
      cursor: null,
      maximumRowsRead: VENUE_PAGE_MAX_ROWS,
      maximumBytesRead: VENUE_PAGE_MAX_BYTES,
    },
  });
  expect(firstPage.isDone).toBe(false);
  expect(firstPage.page.map((venue) => venue.placeId)).not.toContain("late-top");

  const secondPage = await t.query(internal.deck.activeVenuePage, {
    paginationOpts: {
      numItems: VENUE_PAGE_SIZE,
      cursor: firstPage.continueCursor,
      maximumRowsRead: VENUE_PAGE_MAX_ROWS,
      maximumBytesRead: VENUE_PAGE_MAX_BYTES,
    },
  });
  expect(secondPage.page.map((venue) => venue.placeId)).toContain("late-top");

  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
  await asHost.action(api.deck.build, { code: "2222", sessionKey: "hostkey" });
  const stored = await t.run(async (ctx) =>
    ctx.db.query("quests").withIndex("by_room_rank", (q) => q.eq("roomId", roomId)).order("asc").collect(),
  );
  expect(stored[0].placeId).toBe("late-top");
  expect(stored.map((quest) => quest.placeId)).not.toContain("late-inactive");
});

test("the venue catalog ceiling fails before provider work", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const roomId = await roomWithPartner(t);
  await t.run(async (ctx) => {
    for (let i = 0; i < VENUE_CATALOG_CEILING - 1; i++) {
      await ctx.db.insert("venues", {
        placeId: `too-many-${i}`, name: `Too Many ${i}`, suburb: "CBD",
        lat: -37.8, lng: 144.96, priceFromCents: 2000, discountPct: 0,
        offerText: "Catalog row", partnerTier: 1, moods: ["hangout"], active: true,
      });
    }
  });

  await expectUserError(
    t.query(internal.deck.context, { roomId }),
    "VENUE_CATALOG_TOO_LARGE",
    /catalogue is too large/i,
  );

  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
  await expectUserError(
    asHost.action(api.deck.build, { code: "2222", sessionKey: "hostkey" }),
    "VENUE_CATALOG_TOO_LARGE",
    /catalogue is too large/i,
  );
  expect(fetchMock).not.toHaveBeenCalled();
  expect((await t.run(async (ctx) => ctx.db.get(roomId)))!.status).toBe("lobby");
});

test("a required venue page split fails before provider work", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const roomId = await roomWithPartner(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("venues", {
      placeId: "oversized", name: "Oversized", suburb: "CBD",
      lat: -37.8, lng: 144.96, priceFromCents: 2000, discountPct: 0,
      offerText: "x".repeat(VENUE_PAGE_MAX_BYTES * 2), partnerTier: 1,
      moods: ["hangout"], active: true,
    });
  });

  const firstPage = await t.query(internal.deck.activeVenuePage, {
    paginationOpts: {
      numItems: VENUE_PAGE_SIZE,
      cursor: null,
      maximumRowsRead: VENUE_PAGE_MAX_ROWS,
      maximumBytesRead: VENUE_PAGE_MAX_BYTES,
    },
  });
  expect(firstPage.pageStatus).toBe("SplitRequired");
  expect(firstPage.splitCursor).toEqual(expect.any(String));

  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
  await expectUserError(
    asHost.action(api.deck.build, { code: "2222", sessionKey: "hostkey" }),
    "VENUE_CATALOG_TOO_LARGE",
    /catalogue is too large/i,
  );
  expect(fetchMock).not.toHaveBeenCalled();
  expect((await t.run(async (ctx) => ctx.db.get(roomId)))!.status).toBe("lobby");
});

test("insert writes the deck in rank order and flips building to swiping", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const roomId = await roomWithPartner(t);
  const token = await lease(t, roomId);

  const size = await t.mutation(internal.deck.insert, {
    roomId,
    token,
    quests: [
      quest({ rank: 0, source: "partner", placeId: "partner-1", title: "The Long Weekend", score: 4.2 }),
      quest({ rank: 1, placeId: "plain-1", title: "Other", score: 2.6 }),
    ],
  });
  expect(size).toBe(2);

  const stored = await t.run(async (ctx) =>
    ctx.db.query("quests").withIndex("by_room_rank", (q) => q.eq("roomId", roomId)).order("asc").collect(),
  );
  expect(stored.map((q) => q.placeId)).toEqual(["partner-1", "plain-1"]);

  const room = await t.run(async (ctx) => ctx.db.get(roomId));
  expect(room!.status).toBe("swiping");
  expect(room!.deckBuiltAt).toBeGreaterThan(0);
});

test("rebuilding replaces the previous deck rather than appending to it", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const roomId = await roomWithPartner(t);
  await t.mutation(internal.deck.insert, {
    roomId, token: await lease(t, roomId), quests: [quest({ placeId: "old" })],
  });

  // A rebuild is a fresh lease, which the room only grants once it is back in
  // the lobby -- the same door every other build comes through.
  await t.run(async (ctx) => ctx.db.patch(roomId, { status: "lobby" }));
  await t.mutation(internal.deck.insert, {
    roomId, token: await lease(t, roomId), quests: [quest({ placeId: "new" })],
  });

  const stored = await t.run(async (ctx) =>
    ctx.db.query("quests").withIndex("by_room_rank", (q) => q.eq("roomId", roomId)).collect(),
  );
  expect(stored.map((q) => q.placeId)).toEqual(["new"]);
});

test("abandonBuild returns a stuck room to the lobby", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const roomId = await roomWithPartner(t);
  const token = await lease(t, roomId);
  await t.mutation(internal.deck.abandonBuild, { roomId, token });
  expect((await t.run(async (ctx) => ctx.db.get(roomId)))!.status).toBe("lobby");

  // ...and never drags a finished room backwards.
  const second = await lease(t, roomId);
  await t.mutation(internal.deck.insert, { roomId, token: second, quests: [quest({})] });
  await t.mutation(internal.deck.abandonBuild, { roomId, token: second });
  expect((await t.run(async (ctx) => ctx.db.get(roomId)))!.status).toBe("swiping");
});

test("build ranks partners first, weighs mood fit, and caps the deck at nine", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const roomId = await roomWithPartner(t);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });

  const result = await asHost.action(api.deck.build, { code: "2222", sessionKey: "hostkey" });
  expect(result).toEqual({ deckSize: DECK_SIZE });

  // The Places query is driven by the room's mood, not by a hard-coded list.
  expect(callBody(PLACES_URL).includedTypes).toEqual(MOOD_TYPES.hangout);

  const stored = await t.run(async (ctx) =>
    ctx.db.query("quests").withIndex("by_room_rank", (q) => q.eq("roomId", roomId)).order("asc").collect(),
  );
  expect(stored).toHaveLength(DECK_SIZE);
  expect(stored.map((q) => q.rank)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);

  // The partner wins on partnerBoost + discountFit; the six restaurants beat
  // the coffee shops purely on moodFit, so only two coffee shops make the cut.
  expect(stored.map((q) => q.placeId)).toEqual([
    "partner-1", "r0", "r1", "r2", "r3", "r4", "r5", "c0", "c1",
  ]);
  expect(stored[0].source).toBe("partner");

  // moodMatch is COMPUTED, not assumed: a restaurant scores the full moodFit
  // weight, a coffee shop that merely surfaced under the query scores none.
  expect(stored[1].scoreBreakdown.moodFit).toBeCloseTo(1.2);
  expect(stored[7].scoreBreakdown.moodFit).toBe(0);
  expect(stored[1].score).toBeGreaterThan(stored[7].score);

  // A partner's own offer text is the commercial claim and always wins; every
  // other card takes the model's line, merged by index and trimmed.
  expect(stored[0].blurb).toBe("25% off midweek");
  expect(stored[1].blurb).toBe("blurb 1");
  expect(stored[8].blurb).toBe("blurb 8");

  // Cheap Places band, under a $40 budget, rendered as whole dollars.
  expect(stored[1].priceCents).toBe(1500);
  expect(stored[1].priceLabel).toBe("$15");
  // r0 sits on the room centre; r5 is five 0.001-degree steps of longitude east
  // of it, which is 0.44 km at this latitude, rounded to one decimal place.
  expect(stored[1].distanceKm).toBe(0);
  expect(stored[6].distanceKm).toBe(0.4);

  const room = await t.run(async (ctx) => ctx.db.get(roomId));
  expect(room!.status).toBe("swiping");
});

test("build asks OpenAI for JSON from the shared helper", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  await roomWithPartner(t);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
  await asHost.action(api.deck.build, { code: "2222", sessionKey: "hostkey" });

  const body = callBody(OPENAI_URL);
  expect(body.model).toBe("gpt-4o-mini");
  expect(body.response_format).toEqual({ type: "json_object" });
  expect(body.messages[0].content).toContain('for a "hangout" night out');
  // One batched call for all nine blurbs, never nine sequential ones.
  expect(fetchMock.mock.calls.filter(([u]) => String(u) === OPENAI_URL)).toHaveLength(1);
});

test("build still writes a deck when OpenAI is unavailable", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  delete process.env.OPENAI_API_KEY;
  const roomId = await roomWithPartner(t);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });

  const result = await asHost.action(api.deck.build, { code: "2222", sessionKey: "hostkey" });
  expect(result.deckSize).toBe(DECK_SIZE);

  const stored = await t.run(async (ctx) =>
    ctx.db.query("quests").withIndex("by_room_rank", (q) => q.eq("roomId", roomId)).order("asc").collect(),
  );
  // Falls back to the Places editorial summary: a plainer card, not a broken one.
  expect(stored[1].blurb).toBe("A summary for r0.");
});

test("build refuses a member who is not the host", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  await roomWithPartner(t);

  await expectUserError(
    t.action(api.deck.build, { code: "2222", sessionKey: "guestkey" }),
    "NOT_THE_HOST",
    /only the host/i,
  );
  // Quota is never spent on a call the lobby does not offer.
  expect(fetchMock).not.toHaveBeenCalled();
});

test("build refuses a stranger holding no session key", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  await roomWithPartner(t);

  await expectUserError(
    t.action(api.deck.build, { code: "2222", sessionKey: "not-a-key" }),
    "NOT_A_MEMBER",
    /not a member/i,
  );
  expect(fetchMock).not.toHaveBeenCalled();
});

// End to end: a quiz answer given during onboarding changes what the deck
// actually looks like. Without this the affinity could stop anywhere between
// the profile row and the stored card and nothing would notice.
test("a room that likes tonight's mood gets a deck scored for it", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const roomId = await roomWithPartner(t); // "treat"
  await t.run(async (ctx) => {
    await ctx.db.insert("profiles", {
      userId: "u1", displayName: "Bec", tasteVector: [],
      tasteSentence: "", moodAffinity: { grass: 0, sidequest: 0, hangout: 2 }, createdAt: 1,
    });
  });
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });

  await asHost.action(api.deck.build, { code: "2222", sessionKey: "hostkey" });

  const stored = await t.run(async (ctx) =>
    ctx.db.query("quests").withIndex("by_room_rank", (q) => q.eq("roomId", roomId)).order("asc").collect(),
  );
  // A full 1.2 for a neutral room; 1.5x that for a room that asked for this.
  expect(stored[1].scoreBreakdown.moodFit).toBeCloseTo(1.8);
  // And a card that does not match the mood is still worth nothing, however
  // keen the room is.
  expect(stored[7].scoreBreakdown.moodFit).toBe(0);
});

test("build refuses to rebuild a room that is already swiping", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const roomId = await roomWithPartner(t, { status: "swiping" });
  // A swiping room with cards in it is a room mid-game: rebuilding would throw
  // away votes already cast. The guard is about the cards, not the status.
  await seedQuest(t, roomId);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });

  await expectUserError(
    asHost.action(api.deck.build, { code: "2222", sessionKey: "hostkey" }),
    "ROOM_WRONG_STATE",
    /already started/i,
  );
  expect(fetchMock).not.toHaveBeenCalled();
});

// The other half of that guard. A build that died between flipping the room to
// "swiping" and writing the cards used to leave the room permanently stuck:
// status said the game was on, the deck was empty, and the only function that
// could have fixed it refused on the strength of the status. Nobody could swipe
// and nobody could rebuild.
test("build rescues a swiping room that has no cards in it", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const roomId = await roomWithPartner(t, { status: "swiping" });
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });

  const { deckSize } = await asHost.action(api.deck.build, { code: "2222", sessionKey: "hostkey" });

  expect(deckSize).toBeGreaterThan(0);
  const after = await t.run(async (ctx) => ({
    room: await ctx.db.get(roomId),
    quests: await ctx.db
      .query("quests")
      .withIndex("by_room_rank", (q) => q.eq("roomId", roomId))
      .collect(),
  }));
  expect(after.room!.status).toBe("swiping");
  expect(after.quests.length).toBe(deckSize);
});

test("a Google failure hands the room back to the lobby too", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const roomId = await roomWithPartner(t);
  fetchMock.mockImplementation(async () => new Response("upstream is unhappy", { status: 503 }));
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });

  // A ConvexError now. The cause is ours, not the host's, but "Server Error" --
  // which is all a plain Error survives as in production -- told a host who had
  // just tapped "Start the deck" nothing at all, while the room had already
  // been handed back to the lobby underneath them. The operator detail stays in
  // the log; the host gets a sentence and a reason to try again.
  const promise = asHost.action(api.deck.build, { code: "2222", sessionKey: "hostkey" });
  await expect(promise).rejects.toBeInstanceOf(ConvexError);
  await expect(promise).rejects.toMatchObject({ data: { code: "PLACES_UNAVAILABLE" } });

  const room = await t.run(async (ctx) => ctx.db.get(roomId));
  expect(room!.status).toBe("lobby");
});

test("build reports an empty neighbourhood and hands the room back to the lobby", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  // "sidequest" has no partner inventory at all, and Places finds nothing out there.
  const roomId = await roomWithPartner(t, { mood: "sidequest" });
  fetchMock.mockImplementation(async () => json({}));
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });

  await expectUserError(
    asHost.action(api.deck.build, { code: "2222", sessionKey: "hostkey" }),
    "NO_CANDIDATES",
    /could not find anywhere/i,
  );

  const room = await t.run(async (ctx) => ctx.db.get(roomId));
  expect(room!.status).toBe("lobby");
});

// --- The key must not be reachable from anything a client can see ----------

test("no stored quest row carries the Google key", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const roomId = await roomWithPartner(t);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
  await asHost.action(api.deck.build, { code: "2222", sessionKey: "hostkey" });

  const stored = await t.run(async (ctx) =>
    ctx.db.query("quests").withIndex("by_room_rank", (q) => q.eq("roomId", roomId)).collect(),
  );

  // A direct string search over the serialised rows, because that is the claim:
  // not "the field we thought of is clean" but "the key is nowhere in here".
  // These rows outlive the key -- rotating it must not break a built deck.
  const serialised = JSON.stringify(stored);
  expect(serialised).not.toContain(GOOGLE_KEY);
  expect(serialised).not.toContain("key=");
  expect(serialised).not.toContain("places.googleapis.com");

  // What a Places card stores instead: the opaque reference our own route resolves.
  const fromPlaces = stored.find((q) => q.source === "places")!;
  expect(fromPlaces.photoName).toBe("places/r0/photos/photo-r0");
  expect(fromPlaces.photoUrl).toBeUndefined();
});

// --- One build at a time ---------------------------------------------------

test("two concurrent builds produce one deck, not two", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const roomId = await roomWithPartner(t);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });

  // The host double-clicks. Both calls pass the read-only guard, because both
  // read the room before either wrote to it -- the claim is what separates them.
  const outcomes = await Promise.allSettled([
    asHost.action(api.deck.build, { code: "2222", sessionKey: "hostkey" }),
    asHost.action(api.deck.build, { code: "2222", sessionKey: "hostkey" }),
  ]);

  expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
  const rejected = outcomes.find((o) => o.status === "rejected") as PromiseRejectedResult;
  expect(rejected.reason).toBeInstanceOf(ConvexError);
  expect(rejected.reason.data.code).toBe("BUILD_IN_PROGRESS");

  const stored = await t.run(async (ctx) =>
    ctx.db.query("quests").withIndex("by_room_rank", (q) => q.eq("roomId", roomId)).collect(),
  );
  expect(stored).toHaveLength(DECK_SIZE);
  expect((await t.run(async (ctx) => ctx.db.get(roomId)))!.status).toBe("swiping");
});

test("markBuilding refuses a room another build already claimed", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const roomId = await roomWithPartner(t);

  const token = await t.mutation(internal.deck.markBuilding, { roomId });
  expect(token).toEqual(expect.any(String));
  expect(await t.mutation(internal.deck.markBuilding, { roomId })).toBeNull();

  // ...and refuses a room that is past building altogether.
  await t.mutation(internal.deck.insert, { roomId, token: token!, quests: [quest({})] });
  expect(await t.mutation(internal.deck.markBuilding, { roomId })).toBeNull();
});

test("markBuilding takes over a claim whose build was killed", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const roomId = await roomWithPartner(t);
  // A build whose action was killed outright never reaches abandonBuild, so the
  // claim outlives it. After the stale window the room must be buildable again,
  // or one killed action would strand the room forever.
  await t.run(async (ctx) => {
    await ctx.db.patch(roomId, { status: "building", buildStartedAt: Date.now() - 10 * 60 * 1000 });
  });

  expect(await t.mutation(internal.deck.markBuilding, { roomId })).toEqual(expect.any(String));
});

test("a live claim survives a second host attempt with the deck intact", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const roomId = await roomWithPartner(t);
  await t.run(async (ctx) => {
    await ctx.db.patch(roomId, { status: "building", buildStartedAt: Date.now() });
    await ctx.db.insert("quests", { ...quest({ placeId: "in-flight" }), roomId });
  });
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });

  await expectUserError(
    asHost.action(api.deck.build, { code: "2222", sessionKey: "hostkey" }),
    "BUILD_IN_PROGRESS",
    /already being built/i,
  );

  // The loser must not have touched the winner's work, nor the room's state.
  const stored = await t.run(async (ctx) =>
    ctx.db.query("quests").withIndex("by_room_rank", (q) => q.eq("roomId", roomId)).collect(),
  );
  expect(stored.map((q) => q.placeId)).toEqual(["in-flight"]);
  expect((await t.run(async (ctx) => ctx.db.get(roomId)))!.status).toBe("building");
});

// --- Taste ------------------------------------------------------------------

test("the taste re-rank reorders the deck around the room's profile", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const roomId = await roomWithPartner(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("profiles", {
      userId: "u1", displayName: "Bec", tasteVector: TASTE_VECTOR,
      tasteSentence: "a quiet coffee over a long dinner", moodAffinity: {},
      goals: [], createdAt: 1,
    });
  });
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });

  await asHost.action(api.deck.build, { code: "2222", sessionKey: "hostkey" });

  // Every shortlisted candidate was embedded, in one request.
  const embeddingCalls = fetchMock.mock.calls.filter(([u]) => String(u) === EMBEDDINGS_URL);
  expect(embeddingCalls).toHaveLength(1);
  expect(JSON.parse(embeddingCalls[0][1].body as string).input).toHaveLength(13);

  const stored = await t.run(async (ctx) =>
    ctx.db.query("quests").withIndex("by_room_rank", (q) => q.eq("roomId", roomId)).order("asc").collect(),
  );

  // Without taste this deck is partner, r0..r5, c0, c1 -- moodFit puts the six
  // restaurants first. A profile that loves coffee shops and dislikes
  // restaurants outweighs that, and the deck inverts.
  expect(stored.map((q) => q.placeId)).toEqual([
    "partner-1", "c0", "c1", "c2", "c3", "c4", "c5", "r0", "r1",
  ]);
  expect(stored[1].scoreBreakdown.tasteSimilarity).toBeCloseTo(1.1);
  expect(stored[7].scoreBreakdown.tasteSimilarity).toBeCloseTo(-1.1);
});

test("a taste vector of a different width does not shrink the blend", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const roomId = await roomWithPartner(t);
  await t.run(async (ctx) => {
    // A guest member signs in, and their profile predates a model change.
    await ctx.db.insert("members", {
      roomId, name: "Ada", userId: "u2", isHost: false, sessionKey: "adakey", joinedAt: 3,
    });
    await ctx.db.insert("profiles", {
      userId: "u1", displayName: "Bec", tasteVector: TASTE_VECTOR,
      tasteSentence: "coffee", moodAffinity: {}, goals: [], createdAt: 1,
    });
    await ctx.db.insert("profiles", {
      userId: "u2", displayName: "Ada", tasteVector: [0.5, 0.5, 0.5],
      tasteSentence: "an older model", moodAffinity: {}, goals: [], createdAt: 1,
    });
  });
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });

  await asHost.action(api.deck.build, { code: "2222", sessionKey: "hostkey" });

  const stored = await t.run(async (ctx) =>
    ctx.db.query("quests").withIndex("by_room_rank", (q) => q.eq("roomId", roomId)).order("asc").collect(),
  );
  // The mismatched vector is skipped, and the survivor keeps its full weight --
  // halving it would drag tasteSimilarity to 0.55 and lose the reorder.
  expect(stored[1].scoreBreakdown.tasteSimilarity).toBeCloseTo(1.1);
  expect(stored[1].placeId).toBe("c0");
});

// --- Free rooms -------------------------------------------------------------

test("a free room ranks against the free types, not the mood's own list", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const roomId = await roomWithPartner(t, { mood: "sidequest" });
  await t.run(async (ctx) => ctx.db.patch(roomId, { budgetPerHeadCents: 0 }));
  // Google prices neither of these; the park is free to walk into, the cafe is
  // not, and the only thing separating them is the type.
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url) !== PLACES_URL) return json(OPENAI_BODY);
    return json({
      places: [rawPlace("park-1", "park", 0, null), rawPlace("cafe-1", "cafe", 1, null)],
    });
  });
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });

  await asHost.action(api.deck.build, { code: "2222", sessionKey: "hostkey" });

  expect(callBody(PLACES_URL).includedTypes).toEqual(FREE_TYPES);

  const stored = await t.run(async (ctx) =>
    ctx.db.query("quests").withIndex("by_room_rank", (q) => q.eq("roomId", roomId)).order("asc").collect(),
  );
  // The cafe is dropped, not repriced. A $0 room used to have every card's
  // price overwritten with 0, which is how a paid venue ended up advertised as
  // free to a group that had said they could not spend anything.
  expect(stored.map((q) => q.placeId)).toEqual(["park-1"]);
  // moodMatch is measured against the types the room actually asked for. Scored
  // against MOOD_TYPES.sidequest instead this would be 0 and the term would be dead
  // again -- exactly the bug computing it was meant to fix.
  expect(stored[0].scoreBreakdown.moodFit).toBeCloseTo(1.2);
  expect(stored[0].priceCents).toBe(0);
  expect(stored[0].priceLabel).toBe("Free");
});

test("a $0 room keeps a place Google itself calls free, whatever its type", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const roomId = await roomWithPartner(t, { mood: "sidequest" });
  await t.run(async (ctx) => ctx.db.patch(roomId, { budgetPerHeadCents: 0 }));
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url) !== PLACES_URL) return json(OPENAI_BODY);
    return json({
      places: [
        rawPlace("gallery-1", "art_gallery", 0, "PRICE_LEVEL_FREE"),
        // A park Google has priced. Being a park does not make it free once
        // Google has said otherwise, so it goes.
        rawPlace("park-2", "park", 1, "PRICE_LEVEL_MODERATE"),
      ],
    });
  });
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });

  await asHost.action(api.deck.build, { code: "2222", sessionKey: "hostkey" });

  const stored = await t.run(async (ctx) =>
    ctx.db.query("quests").withIndex("by_room_rank", (q) => q.eq("roomId", roomId)).order("asc").collect(),
  );
  expect(stored.map((q) => q.placeId)).toEqual(["gallery-1"]);
  expect(stored[0].priceCents).toBe(0);
});

// An empty deck is the one room state with no way out of it: swiping, no cards,
// nothing to tap, and `waitingOn` reading "waiting on nobody" for everyone --
// a room that displays as finished and cannot be finished. The write that would
// create it is refused at the door.
test("insert refuses to open swiping on an empty deck", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const roomId = await roomWithPartner(t);
  const token = await lease(t, roomId);

  await expect(
    t.mutation(internal.deck.insert, { roomId, token, quests: [] }),
  ).rejects.toThrow(/empty deck/i);

  // The transaction rolled back: the room was never flipped to swiping, so
  // nobody is looking at a screen with no cards on it.
  const after = await t.run(async (ctx) => ({
    room: await ctx.db.get(roomId),
    quests: await ctx.db.query("quests").collect(),
  }));
  expect(after.room!.status).not.toBe("swiping");
  expect(after.quests).toHaveLength(0);
});

// --- The lease: a stalled build must not overwrite the deck that replaced it

test("a stalled build whose lease was taken cannot destroy the newer deck", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const roomId = await roomWithPartner(t);

  // Build one takes the room, then stalls -- long enough for its claim to go
  // stale. It is still running; nothing has told it to stop.
  const stalled = await lease(t, roomId);
  await t.run(async (ctx) => {
    await ctx.db.patch(roomId, { buildStartedAt: Date.now() - 10 * 60 * 1000 });
  });

  // Build two takes over the stale claim and finishes. The room is swiping, and
  // members start casting swipes against ITS deck.
  const took = await lease(t, roomId);
  expect(took).not.toBe(stalled);
  expect(
    await t.mutation(internal.deck.insert, {
      roomId, token: took, quests: [quest({ placeId: "newer-deck" })],
    }),
  ).toBe(1);

  const { questId, memberId } = await t.run(async (ctx) => {
    const q = await ctx.db
      .query("quests")
      .withIndex("by_room_rank", (i) => i.eq("roomId", roomId))
      .first();
    const member = await ctx.db
      .query("members")
      .withIndex("by_room", (i) => i.eq("roomId", roomId))
      .first();
    const swipeId = await ctx.db.insert("swipes", {
      roomId, questId: q!._id, memberId: member!._id, dir: "yes",
    });
    return { questId: q!._id, memberId: swipeId };
  });

  // Now build one finally comes back. Its insert deletes the whole deck before
  // writing, so without the lease check it would destroy the deck the room is
  // already swiping and orphan every swipe cast against it.
  expect(
    await t.mutation(internal.deck.insert, {
      roomId, token: stalled, quests: [quest({ placeId: "stale-deck" })],
    }),
  ).toBeNull();

  const stored = await t.run(async (ctx) =>
    ctx.db.query("quests").withIndex("by_room_rank", (i) => i.eq("roomId", roomId)).collect(),
  );
  expect(stored.map((q) => q.placeId)).toEqual(["newer-deck"]);
  expect(stored[0]._id).toBe(questId);

  // The swipe still points at a quest that exists -- which is the whole point.
  const swipes = await t.run(async (ctx) =>
    ctx.db.query("swipes").withIndex("by_room_quest", (i) => i.eq("roomId", roomId)).collect(),
  );
  expect(swipes).toHaveLength(1);
  expect(swipes[0].questId).toBe(questId);
  expect(await t.run(async (ctx) => ctx.db.get(swipes[0].questId))).not.toBeNull();
  expect(memberId).toBe(swipes[0]._id);

  // ...and the room is left as build two set it, not as build one wanted it.
  expect((await t.run(async (ctx) => ctx.db.get(roomId)))!.status).toBe("swiping");
});

test("a stalled build cannot hand back a room a newer build now holds", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const roomId = await roomWithPartner(t);

  const stalled = await lease(t, roomId);
  await t.run(async (ctx) => {
    await ctx.db.patch(roomId, { buildStartedAt: Date.now() - 10 * 60 * 1000 });
  });
  const took = await lease(t, roomId);

  // Build one fails and tries to return the room to the lobby. Build two is
  // still working; knocking the room back would strand it holding a lease on a
  // room that says it is not being built.
  await t.mutation(internal.deck.abandonBuild, { roomId, token: stalled });

  const room = await t.run(async (ctx) => ctx.db.get(roomId));
  expect(room!.status).toBe("building");
  expect(room!.buildToken).toBe(took);
});

test("build tells a superseded host that a newer deck is ready", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const roomId = await roomWithPartner(t);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });

  // The lease is stolen mid-build: Places answers, and while the action is
  // still working someone else takes the stale claim and finishes a deck.
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url) !== PLACES_URL) return json(OPENAI_BODY);
    await t.run(async (ctx) => {
      await ctx.db.patch(roomId, { buildStartedAt: Date.now() - 10 * 60 * 1000 });
    });
    const took = await lease(t, roomId);
    await t.mutation(internal.deck.insert, {
      roomId, token: took, quests: [quest({ placeId: "newer-deck" })],
    });
    return json(PLACES_BODY);
  });

  await expectUserError(
    asHost.action(api.deck.build, { code: "2222", sessionKey: "hostkey" }),
    "BUILD_SUPERSEDED",
    /newer one is ready/i,
  );

  const stored = await t.run(async (ctx) =>
    ctx.db.query("quests").withIndex("by_room_rank", (i) => i.eq("roomId", roomId)).collect(),
  );
  expect(stored.map((q) => q.placeId)).toEqual(["newer-deck"]);
  // The superseded build's error handler must not have touched the room either.
  expect((await t.run(async (ctx) => ctx.db.get(roomId)))!.status).toBe("swiping");
});

// A degraded build must leave a trail. Asserted rather than described, because
// the round-1 claim that this catch logged was wrong: the replacement never
// applied, the comment inside the catch read like a log line, and nothing
// caught it. A test cannot be satisfied by a comment.
test("a failed taste re-rank says so in the logs", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const roomId = await roomWithPartner(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("profiles", {
      userId: "u1", displayName: "Bec", tasteVector: TASTE_VECTOR,
      tasteSentence: "coffee", moodAffinity: {}, goals: [], createdAt: 1,
    });
  });
  // Places answers; the embeddings endpoint does not.
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url) === PLACES_URL) return json(PLACES_BODY);
    if (String(url) === OPENAI_URL) return json(OPENAI_BODY);
    return new Response("rate limited", { status: 429 });
  });
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });

  const result = await asHost.action(api.deck.build, { code: "2222", sessionKey: "hostkey" });

  // The deck is still built -- ranking without taste is worse, not broken.
  expect(result.deckSize).toBe(DECK_SIZE);
  expect(warn).toHaveBeenCalledWith(
    "deck.build: taste re-rank skipped, ranking without it.",
    expect.anything(),
  );

  const stored = await t.run(async (ctx) =>
    ctx.db.query("quests").withIndex("by_room_rank", (i) => i.eq("roomId", roomId)).order("asc").collect(),
  );
  // ...and it fell back to the mood ordering rather than a half-applied one.
  expect(stored[1].placeId).toBe("r0");
  expect(stored[1].scoreBreakdown.tasteSimilarity).toBe(0);
});

test("a failed blurb call says so in the logs", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  delete process.env.OPENAI_API_KEY;
  await roomWithPartner(t);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });

  await asHost.action(api.deck.build, { code: "2222", sessionKey: "hostkey" });

  expect(warn).toHaveBeenCalledWith(
    "deck.build: no blurbs, falling back to the Places summary.",
    expect.anything(),
  );
});

/**
 * The case the embedding cache exists for, driven end to end through two real
 * builds rather than seeded rows.
 *
 * The first room does a full build: Places, then the taste re-rank, then the
 * blurbs. The second room borrows that finished deck. It must not pay OpenAI
 * again for venues the first room just embedded.
 *
 * WHY THIS IS THE TEST AND NOT THE SEEDED ONE IN `deckCache.test.ts`. The two
 * paths do not hold the same words for the same place at the moment they rank.
 * A full build has only the Google summary, because `writeBlurbs` runs AFTER
 * `rankByTaste`; a borrowing build has the finished LLM blurb off the stored
 * quest row. Keyed on that string the cache would miss on every borrowed
 * places card while every other test still passed, which is exactly what the
 * first version of this change did.
 */
test("a room borrowing a deck re-uses the embeddings the first build paid for", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  await roomWithPartner(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("profiles", {
      userId: "u1", displayName: "Bec", tasteVector: TASTE_VECTOR,
      tasteSentence: "likes coffee", moodAffinity: {}, createdAt: 1,
    });
  });
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });

  await asHost.action(api.deck.build, { code: "2222", sessionKey: "hostkey" });
  const embedCalls = () =>
    fetchMock.mock.calls.filter(([url]) => String(url) === EMBEDDINGS_URL).length;
  expect(embedCalls()).toBe(1);

  // Same mood, budget, centre and radius, so `recentDeck` hands this room the
  // first room's cards.
  await t.run(async (ctx) => {
    const roomId = await ctx.db.insert("rooms", {
      hostUserId: "u1", mood: "hangout", headcount: 4, budgetPerHeadCents: 4000,
      whenAt: 1_800_000_000_000, centreLat: -37.8, centreLng: 144.96, radiusKm: 5,
      visibility: "private", status: "lobby", code: "3333",
    });
    await ctx.db.insert("members", {
      roomId, name: "Bec", userId: "u1", isHost: true, sessionKey: "hostkey2", joinedAt: 1,
    });
  });

  const borrowed = await asHost.action(api.deck.build, { code: "3333", sessionKey: "hostkey2" });

  expect(borrowed.deckSize).toBeGreaterThan(0);
  // The whole assertion: not one more embeddings request, and no Places call
  // either, for a deck that was already built.
  expect(embedCalls()).toBe(1);

  // And the re-rank still ran on the cached vectors rather than being skipped
  // -- `rankByTaste` swallows its own failures, so a broken cache would look
  // like a quietly untasted deck instead of an error.
  const stored = await t.run(async (ctx) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", "3333"))
      .unique();
    return await ctx.db
      .query("quests")
      .withIndex("by_room_rank", (q) => q.eq("roomId", room!._id))
      .order("asc")
      .collect();
  });
  expect(stored.some((q) => (q.scoreBreakdown.tasteSimilarity ?? 0) > 0)).toBe(true);
});
