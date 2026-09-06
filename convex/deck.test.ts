/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { DECK_SIZE, FREE_TYPES, MOOD_TYPES } from "./lib/scoring";

const modules = import.meta.glob("./**/*.ts");

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
  t: ReturnType<typeof convexTest>,
  over: { mood?: "grass" | "meet" | "treat" | "new"; status?: "lobby" | "swiping" } = {},
) {
  return await t.run(async (ctx) => {
    const roomId = await ctx.db.insert("rooms", {
      hostUserId: "u1",
      mood: over.mood ?? "treat",
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
      offerText: "25% off midweek", partnerTier: 3, moods: ["treat"], active: true,
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
const rawPlace = (id: string, primaryType: string, i: number) => ({
  id,
  displayName: { text: `Place ${id}` },
  formattedAddress: `${i} Smith St, Fitzroy VIC`,
  location: { latitude: -37.8, longitude: 144.96 + i * 0.001 },
  primaryType,
  primaryTypeDisplayName: { text: primaryType },
  types: [primaryType, "restaurant"],
  priceLevel: "PRICE_LEVEL_INEXPENSIVE",
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
});

test("insert writes the deck in rank order and flips building to swiping", async () => {
  const t = convexTest(schema, modules);
  const roomId = await roomWithPartner(t);
  await t.mutation(internal.deck.markBuilding, { roomId });

  const size = await t.mutation(internal.deck.insert, {
    roomId,
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
  const roomId = await roomWithPartner(t);
  await t.mutation(internal.deck.insert, { roomId, quests: [quest({ placeId: "old" })] });
  await t.mutation(internal.deck.insert, { roomId, quests: [quest({ placeId: "new" })] });

  const stored = await t.run(async (ctx) =>
    ctx.db.query("quests").withIndex("by_room_rank", (q) => q.eq("roomId", roomId)).collect(),
  );
  expect(stored.map((q) => q.placeId)).toEqual(["new"]);
});

test("abandonBuild returns a stuck room to the lobby", async () => {
  const t = convexTest(schema, modules);
  const roomId = await roomWithPartner(t);
  await t.mutation(internal.deck.markBuilding, { roomId });
  await t.mutation(internal.deck.abandonBuild, { roomId });
  expect((await t.run(async (ctx) => ctx.db.get(roomId)))!.status).toBe("lobby");

  // ...and never drags a finished room backwards.
  await t.mutation(internal.deck.insert, { roomId, quests: [quest({})] });
  await t.mutation(internal.deck.abandonBuild, { roomId });
  expect((await t.run(async (ctx) => ctx.db.get(roomId)))!.status).toBe("swiping");
});

test("build ranks partners first, weighs mood fit, and caps the deck at nine", async () => {
  const t = convexTest(schema, modules);
  const roomId = await roomWithPartner(t);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });

  const result = await asHost.action(api.deck.build, { code: "2222", sessionKey: "hostkey" });
  expect(result).toEqual({ deckSize: DECK_SIZE });

  // The Places query is driven by the room's mood, not by a hard-coded list.
  expect(callBody(PLACES_URL).includedTypes).toEqual(MOOD_TYPES.treat);

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
  await roomWithPartner(t);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
  await asHost.action(api.deck.build, { code: "2222", sessionKey: "hostkey" });

  const body = callBody(OPENAI_URL);
  expect(body.model).toBe("gpt-4o-mini");
  expect(body.response_format).toEqual({ type: "json_object" });
  expect(body.messages[0].content).toContain('for a "treat" night out');
  // One batched call for all nine blurbs, never nine sequential ones.
  expect(fetchMock.mock.calls.filter(([u]) => String(u) === OPENAI_URL)).toHaveLength(1);
});

test("build still writes a deck when OpenAI is unavailable", async () => {
  const t = convexTest(schema, modules);
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
  await roomWithPartner(t);

  await expectUserError(
    t.action(api.deck.build, { code: "2222", sessionKey: "not-a-key" }),
    "NOT_A_MEMBER",
    /not a member/i,
  );
  expect(fetchMock).not.toHaveBeenCalled();
});

test("build refuses to rebuild a room that is already swiping", async () => {
  const t = convexTest(schema, modules);
  await roomWithPartner(t, { status: "swiping" });
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });

  await expectUserError(
    asHost.action(api.deck.build, { code: "2222", sessionKey: "hostkey" }),
    "ROOM_WRONG_STATE",
    /already started/i,
  );
  expect(fetchMock).not.toHaveBeenCalled();
});

test("a Google failure hands the room back to the lobby too", async () => {
  const t = convexTest(schema, modules);
  const roomId = await roomWithPartner(t);
  fetchMock.mockImplementation(async () => new Response("upstream is unhappy", { status: 503 }));
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });

  // Not a ConvexError: an upstream 5xx is our problem, not something the user
  // can act on, so redacting it in production is the right behaviour.
  await expect(
    asHost.action(api.deck.build, { code: "2222", sessionKey: "hostkey" }),
  ).rejects.toThrow(/Places API 503/);

  const room = await t.run(async (ctx) => ctx.db.get(roomId));
  expect(room!.status).toBe("lobby");
});

test("build reports an empty neighbourhood and hands the room back to the lobby", async () => {
  const t = convexTest(schema, modules);
  // "new" has no partner inventory at all, and Places finds nothing out there.
  const roomId = await roomWithPartner(t, { mood: "new" });
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
  const roomId = await roomWithPartner(t);

  expect(await t.mutation(internal.deck.markBuilding, { roomId })).toBe(true);
  expect(await t.mutation(internal.deck.markBuilding, { roomId })).toBe(false);

  // ...and refuses a room that is past building altogether.
  await t.mutation(internal.deck.insert, { roomId, quests: [quest({})] });
  expect(await t.mutation(internal.deck.markBuilding, { roomId })).toBe(false);
});

test("markBuilding takes over a claim whose build was killed", async () => {
  const t = convexTest(schema, modules);
  const roomId = await roomWithPartner(t);
  // A build whose action was killed outright never reaches abandonBuild, so the
  // claim outlives it. After the stale window the room must be buildable again,
  // or one killed action would strand the room forever.
  await t.run(async (ctx) => {
    await ctx.db.patch(roomId, { status: "building", buildStartedAt: Date.now() - 10 * 60 * 1000 });
  });

  expect(await t.mutation(internal.deck.markBuilding, { roomId })).toBe(true);
});

test("a live claim survives a second host attempt with the deck intact", async () => {
  const t = convexTest(schema, modules);
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
  const roomId = await roomWithPartner(t, { mood: "new" });
  await t.run(async (ctx) => ctx.db.patch(roomId, { budgetPerHeadCents: 0 }));
  // A park is free to walk into; a cafe surfaced under the same query is not.
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url) !== PLACES_URL) return json(OPENAI_BODY);
    return json({ places: [rawPlace("park-1", "park", 0), rawPlace("cafe-1", "cafe", 1)] });
  });
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });

  await asHost.action(api.deck.build, { code: "2222", sessionKey: "hostkey" });

  expect(callBody(PLACES_URL).includedTypes).toEqual(FREE_TYPES);

  const stored = await t.run(async (ctx) =>
    ctx.db.query("quests").withIndex("by_room_rank", (q) => q.eq("roomId", roomId)).order("asc").collect(),
  );
  expect(stored.map((q) => q.placeId)).toEqual(["park-1", "cafe-1"]);
  // moodMatch is measured against the types the room actually asked for. Scored
  // against MOOD_TYPES.new instead, both would be 0 and the term would be dead
  // again -- exactly the bug computing it was meant to fix.
  expect(stored[0].scoreBreakdown.moodFit).toBeCloseTo(1.2);
  expect(stored[1].scoreBreakdown.moodFit).toBe(0);
  // Nothing costs money in a free room, whatever band Places reported.
  expect(stored.map((q) => q.priceCents)).toEqual([0, 0]);
  expect(stored[0].priceLabel).toBe("Free");
});
