/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// `ReturnType<typeof convexTest>` silently drops the schema types: vitest stays
// green while `tsc` reports errors. The schema-aware handle keeps the real
// document types in every helper below.
type T = TestConvex<typeof schema>;

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

const ROOM = {
  hostUserId: "u1",
  mood: "grass" as const,
  headcount: 2,
  budgetPerHeadCents: 0,
  whenAt: 1_800_000_000_000,
  centreLat: -37.8,
  centreLng: 144.96,
  radiusKm: 5,
  visibility: "private" as const,
};

const QUEST = {
  source: "places" as const,
  blurb: "",
  priceLabel: "Free",
  priceCents: 0,
  discountPct: 0,
  scoreBreakdown: {},
};

/** Two members, two cards. Card `a` is rank 0 and the higher score. */
async function twoPersonRoom(t: T) {
  return await t.run(async (ctx) => {
    const roomId = await ctx.db.insert("rooms", { ...ROOM, status: "swiping", code: "3333" });
    await ctx.db.insert("members", { roomId, name: "Bec", isHost: true, sessionKey: "k-bec", joinedAt: 1 });
    await ctx.db.insert("members", { roomId, name: "Tam", isHost: false, sessionKey: "k-tam", joinedAt: 2 });
    const a = await ctx.db.insert("quests", {
      ...QUEST, roomId, rank: 0, placeId: "a", title: "Princes Park", distanceKm: 1, score: 3,
    });
    const b = await ctx.db.insert("quests", {
      ...QUEST, roomId, rank: 1, placeId: "b", title: "The Tan", distanceKm: 2, score: 2,
    });
    return { roomId, a, b };
  });
}

/**
 * Run the work the match handed off.
 *
 * `finishInProgressScheduledFunctions()` alone is not enough here: it drains
 * only jobs already in the "inProgress" state, and a job posted by
 * `runAfter(0)` from a mutation is still "pending" when the mutation returns,
 * so it would be left un-run and the assertion would pass over an empty table.
 * `finishAllScheduledFunctions` drives the timers first, which is what actually
 * starts it. (convex-test 0.0.56, node_modules/convex-test/dist/index.d.ts.)
 */
async function runScheduled(t: T) {
  vi.useFakeTimers();
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  vi.useRealTimers();
}

/** Say no to every card, from every phone, in order. */
async function exhaustTheDeck(t: T, quests: Id<"quests">[]) {
  for (const sessionKey of ["k-bec", "k-tam"]) {
    for (const questId of quests) {
      await t.mutation(api.swipes.cast, { code: "3333", sessionKey, questId, dir: "no" });
    }
  }
}

// No key, no network. `plans.generate` runs for real behind the match, so an
// unstubbed `fetch` here would be a live call from the test suite.
const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;
const savedKey = process.env.OPENAI_API_KEY;

beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
  fetchMock = vi.fn(async (url: string) => {
    throw new Error(`Unexpected fetch to ${url}`);
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  vi.useRealTimers();
  if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = savedKey;
});

// --- unanimity ------------------------------------------------------------

test("one yes is not a match", async () => {
  const t = convexTest(schema, modules);
  const { a } = await twoPersonRoom(t);
  const r = await t.mutation(api.swipes.cast, { code: "3333", sessionKey: "k-bec", questId: a, dir: "yes" });
  expect(r).toEqual({ matched: false, questId: null });
});

test("the last yes matches immediately", async () => {
  const t = convexTest(schema, modules);
  const { roomId, a } = await twoPersonRoom(t);
  await t.mutation(api.swipes.cast, { code: "3333", sessionKey: "k-bec", questId: a, dir: "yes" });
  const r = await t.mutation(api.swipes.cast, { code: "3333", sessionKey: "k-tam", questId: a, dir: "yes" });
  expect(r.matched).toBe(true);
  expect(r.questId).toBe(a);

  const room = await t.run(async (ctx) => ctx.db.get(roomId));
  expect(room!.status).toBe("matched");
  expect(room!.matchedQuestId).toBe(a);
});

test("one no blocks the match on that card", async () => {
  const t = convexTest(schema, modules);
  const { a } = await twoPersonRoom(t);
  await t.mutation(api.swipes.cast, { code: "3333", sessionKey: "k-bec", questId: a, dir: "yes" });
  const r = await t.mutation(api.swipes.cast, { code: "3333", sessionKey: "k-tam", questId: a, dir: "no" });
  expect(r.matched).toBe(false);
});

test("a card everyone passed earlier still matches once the last no becomes a yes", async () => {
  const t = convexTest(schema, modules);
  const { roomId, a } = await twoPersonRoom(t);
  await t.mutation(api.swipes.cast, { code: "3333", sessionKey: "k-bec", questId: a, dir: "yes" });
  await t.mutation(api.swipes.cast, { code: "3333", sessionKey: "k-tam", questId: a, dir: "no" });
  const r = await t.mutation(api.swipes.cast, { code: "3333", sessionKey: "k-tam", questId: a, dir: "yes" });
  expect(r).toEqual({ matched: true, questId: a });

  const room = await t.run(async (ctx) => ctx.db.get(roomId));
  expect(room!.matchedQuestId).toBe(a);
});

// --- the plan hand-off ----------------------------------------------------

test("the match schedules the plan, and the plan lands on the room", async () => {
  const t = convexTest(schema, modules);
  const { roomId, a } = await twoPersonRoom(t);
  await t.mutation(api.swipes.cast, { code: "3333", sessionKey: "k-bec", questId: a, dir: "yes" });
  await t.mutation(api.swipes.cast, { code: "3333", sessionKey: "k-tam", questId: a, dir: "yes" });

  // The match itself must not wait on the plan, so nothing is written yet.
  expect(await t.run(async (ctx) => ctx.db.query("plans").collect())).toHaveLength(0);

  await runScheduled(t);

  const plans = await t.run(async (ctx) => ctx.db.query("plans").collect());
  expect(plans).toHaveLength(1);
  expect(plans[0].roomId).toBe(roomId);
  expect(plans[0].questId).toBe(a);
  expect(plans[0].stops.length).toBeGreaterThan(0);
  // No key is set, so this is the canned night -- and it never touched the wire.
  expect(fetchMock).not.toHaveBeenCalled();
});

test("a room that already matched does not schedule a second plan build", async () => {
  const t = convexTest(schema, modules);
  const { a, b } = await twoPersonRoom(t);
  await t.mutation(api.swipes.cast, { code: "3333", sessionKey: "k-bec", questId: a, dir: "yes" });
  await t.mutation(api.swipes.cast, { code: "3333", sessionKey: "k-tam", questId: a, dir: "yes" });
  await t.mutation(api.swipes.cast, { code: "3333", sessionKey: "k-bec", questId: b, dir: "yes" });
  await t.mutation(api.swipes.cast, { code: "3333", sessionKey: "k-tam", questId: b, dir: "yes" });

  await runScheduled(t);
  const plans = await t.run(async (ctx) => ctx.db.query("plans").collect());
  expect(plans).toHaveLength(1);
  expect(plans[0].questId).toBe(a);
});

// --- exhaustion -----------------------------------------------------------

test("exhausting the deck with no unanimous card declares the top-scored one", async () => {
  const t = convexTest(schema, modules);
  const { roomId, a, b } = await twoPersonRoom(t);
  await exhaustTheDeck(t, [a, b]);

  const room = await t.run(async (ctx) => ctx.db.get(roomId));
  expect(room!.status).toBe("matched");
  expect(room!.matchedQuestId).toBe(a); // rank 0, and the higher score
});

test("exhaustion follows the score, not the rank, when the two disagree", async () => {
  const t = convexTest(schema, modules);
  const { roomId, a, b } = await twoPersonRoom(t);
  // deck.ts writes rank in descending score order, so these agree for every
  // deck the app builds. A hand-written or re-ranked deck must still declare
  // the best card, not merely the first one.
  await t.run(async (ctx) => {
    await ctx.db.patch(a, { score: 1 });
    await ctx.db.patch(b, { score: 9 });
  });
  await exhaustTheDeck(t, [a, b]);

  const room = await t.run(async (ctx) => ctx.db.get(roomId));
  expect(room!.matchedQuestId).toBe(b);
});

test("the deck is not exhausted while one phone is still swiping", async () => {
  const t = convexTest(schema, modules);
  const { roomId, a, b } = await twoPersonRoom(t);
  for (const questId of [a, b]) {
    await t.mutation(api.swipes.cast, { code: "3333", sessionKey: "k-bec", questId, dir: "no" });
  }
  const r = await t.mutation(api.swipes.cast, { code: "3333", sessionKey: "k-tam", questId: a, dir: "no" });
  expect(r.matched).toBe(false);

  const room = await t.run(async (ctx) => ctx.db.get(roomId));
  expect(room!.status).toBe("swiping");
});

test("a swiping room with an empty deck resolves instead of waiting forever", async () => {
  const t = convexTest(schema, modules);
  // Nothing in the schema forbids a swiping room with no cards, and such a room
  // can neither reach unanimity nor exhaust its deck. It must not hang: it goes
  // back to the lobby, where the host can build a deck again.
  const { roomId, foreignQuestId } = await t.run(async (ctx) => {
    const roomId = await ctx.db.insert("rooms", { ...ROOM, status: "swiping", code: "4444" });
    await ctx.db.insert("members", { roomId, name: "Bec", isHost: true, sessionKey: "k-bec", joinedAt: 1 });

    const otherRoomId = await ctx.db.insert("rooms", { ...ROOM, status: "swiping", code: "5555" });
    const foreignQuestId = await ctx.db.insert("quests", {
      ...QUEST, roomId: otherRoomId, rank: 0, placeId: "x", title: "Elsewhere", distanceKm: 1, score: 5,
    });
    return { roomId, foreignQuestId };
  });

  const r = await t.mutation(api.swipes.cast, {
    code: "4444", sessionKey: "k-bec", questId: foreignQuestId, dir: "yes",
  });
  expect(r).toEqual({ matched: false, questId: null });

  const room = await t.run(async (ctx) => ctx.db.get(roomId));
  expect(room!.status).toBe("lobby");
  expect(await t.run(async (ctx) => ctx.db.query("swipes").collect())).toHaveLength(0);
});

// --- idempotency ----------------------------------------------------------

test("changing your mind overwrites rather than double-counting", async () => {
  const t = convexTest(schema, modules);
  const { a } = await twoPersonRoom(t);
  await t.mutation(api.swipes.cast, { code: "3333", sessionKey: "k-bec", questId: a, dir: "yes" });
  const r = await t.mutation(api.swipes.cast, { code: "3333", sessionKey: "k-bec", questId: a, dir: "yes" });
  expect(r.matched).toBe(false);

  const swipes = await t.run(async (ctx) => ctx.db.query("swipes").collect());
  expect(swipes).toHaveLength(1);
  expect(swipes[0].dir).toBe("yes");
});

test("a no over a yes replaces it, and one member cannot supply the other's yes", async () => {
  const t = convexTest(schema, modules);
  const { a } = await twoPersonRoom(t);
  await t.mutation(api.swipes.cast, { code: "3333", sessionKey: "k-bec", questId: a, dir: "yes" });
  await t.mutation(api.swipes.cast, { code: "3333", sessionKey: "k-bec", questId: a, dir: "no" });
  const r = await t.mutation(api.swipes.cast, { code: "3333", sessionKey: "k-bec", questId: a, dir: "yes" });
  expect(r.matched).toBe(false);

  const swipes = await t.run(async (ctx) => ctx.db.query("swipes").collect());
  expect(swipes).toHaveLength(1);
});

test("swiping after the match is over is a no-op that reports the winner", async () => {
  const t = convexTest(schema, modules);
  const { a, b } = await twoPersonRoom(t);
  await t.mutation(api.swipes.cast, { code: "3333", sessionKey: "k-bec", questId: a, dir: "yes" });
  await t.mutation(api.swipes.cast, { code: "3333", sessionKey: "k-tam", questId: a, dir: "yes" });

  const late = await t.mutation(api.swipes.cast, { code: "3333", sessionKey: "k-bec", questId: b, dir: "yes" });
  expect(late).toEqual({ matched: true, questId: a });

  // The late swipe wrote nothing: only the two yeses on `a` exist.
  const swipes = await t.run(async (ctx) => ctx.db.query("swipes").collect());
  expect(swipes).toHaveLength(2);
});

// --- authorisation --------------------------------------------------------

test("a stranger's session key cannot swipe in the room", async () => {
  const t = convexTest(schema, modules);
  const { a } = await twoPersonRoom(t);
  await expectUserError(
    t.mutation(api.swipes.cast, { code: "3333", sessionKey: "k-nobody", questId: a, dir: "yes" }),
    "NOT_A_MEMBER",
    /not a member/i,
  );
});

test("an unknown room code is refused", async () => {
  const t = convexTest(schema, modules);
  const { a } = await twoPersonRoom(t);
  await expectUserError(
    t.mutation(api.swipes.cast, { code: "9999", sessionKey: "k-bec", questId: a, dir: "yes" }),
    "ROOM_NOT_FOUND",
    /no room with code/i,
  );
});

test("a member cannot pin a swipe onto another room's card", async () => {
  const t = convexTest(schema, modules);
  const { a } = await twoPersonRoom(t);
  const foreignQuestId = await t.run(async (ctx) => {
    const otherRoomId = await ctx.db.insert("rooms", { ...ROOM, status: "swiping", code: "5555" });
    return await ctx.db.insert("quests", {
      ...QUEST, roomId: otherRoomId, rank: 0, placeId: "x", title: "Elsewhere", distanceKm: 1, score: 5,
    });
  });

  await expectUserError(
    t.mutation(api.swipes.cast, { code: "3333", sessionKey: "k-bec", questId: foreignQuestId, dir: "yes" }),
    "QUEST_NOT_FOUND",
    /not in this room/i,
  );
  expect(await t.run(async (ctx) => ctx.db.query("swipes").collect())).toHaveLength(0);
  // The room's own deck is untouched and still swipeable.
  const r = await t.mutation(api.swipes.cast, { code: "3333", sessionKey: "k-bec", questId: a, dir: "yes" });
  expect(r.matched).toBe(false);
});

test("a room that has not started swiping cannot be swiped", async () => {
  const t = convexTest(schema, modules);
  const { a } = await twoPersonRoom(t);
  await t.run(async (ctx) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", "3333"))
      .unique();
    await ctx.db.patch(room!._id, { status: "lobby" });
  });

  await expectUserError(
    t.mutation(api.swipes.cast, { code: "3333", sessionKey: "k-bec", questId: a, dir: "yes" }),
    "ROOM_WRONG_STATE",
    /not swiping/i,
  );
});

// --- the roster is the other half of both match conditions -----------------
//
// Unanimity and exhaustion are both quantified over `members`, so a match
// becomes possible when the roster shrinks just as much as when a swipe
// arrives. Resolution therefore lives in `convex/lib/match.ts` and runs from
// `swipes.cast`, `rooms.leave` and `rooms.removeMember` alike -- one
// implementation, so the copies cannot drift.

/** The two-person room plus a third member who has not swiped anything. */
async function threePersonRoom(t: T, thirdKey: string) {
  const ids = await twoPersonRoom(t);
  const samId = await t.run(async (ctx) =>
    ctx.db.insert("members", {
      roomId: ids.roomId, name: "Sam", isHost: false, sessionKey: thirdKey, joinedAt: 3,
    }),
  );
  return { ...ids, samId };
}

test("three people, two exhaust the deck, and the third leaving resolves the room", async () => {
  const t = convexTest(schema, modules);
  const { roomId, a, b } = await threePersonRoom(t, "k-sam");
  await exhaustTheDeck(t, [a, b]);

  // Nobody can swipe the room out of this: the deck is empty and Sam has not
  // touched it. Before the shared resolver this hung on "swiping" forever.
  expect((await t.run(async (ctx) => ctx.db.get(roomId)))!.status).toBe("swiping");

  await t.mutation(api.rooms.leave, { code: "3333", sessionKey: "k-sam" });

  const room = await t.run(async (ctx) => ctx.db.get(roomId));
  expect(room!.status).toBe("matched");
  expect(room!.matchedQuestId).toBe(a); // the top-scored card

  await runScheduled(t);
  const plans = await t.run(async (ctx) => ctx.db.query("plans").collect());
  expect(plans).toHaveLength(1);
});

test("two people, one has said yes, and the other leaving makes it unanimous", async () => {
  const t = convexTest(schema, modules);
  const { roomId, a } = await twoPersonRoom(t);
  await t.mutation(api.swipes.cast, { code: "3333", sessionKey: "k-bec", questId: a, dir: "yes" });
  expect((await t.run(async (ctx) => ctx.db.get(roomId)))!.status).toBe("swiping");

  await t.mutation(api.rooms.leave, { code: "3333", sessionKey: "k-tam" });

  const room = await t.run(async (ctx) => ctx.db.get(roomId));
  expect(room!.status).toBe("matched");
  expect(room!.matchedQuestId).toBe(a);
});

test("leaving a room that already matched does not build a second plan", async () => {
  const t = convexTest(schema, modules);
  const { roomId, a } = await twoPersonRoom(t);
  for (const sessionKey of ["k-bec", "k-tam"]) {
    await t.mutation(api.swipes.cast, { code: "3333", sessionKey, questId: a, dir: "yes" });
  }
  await runScheduled(t);
  const before = await t.run(async (ctx) => ctx.db.query("plans").collect());
  expect(before).toHaveLength(1);

  await t.mutation(api.rooms.leave, { code: "3333", sessionKey: "k-tam" });
  await runScheduled(t);

  const after = await t.run(async (ctx) => ctx.db.query("plans").collect());
  expect(after).toHaveLength(1);
  expect(after[0]._id).toBe(before[0]._id);
  expect(after[0].stops).toEqual(before[0].stops);

  const room = await t.run(async (ctx) => ctx.db.get(roomId));
  expect(room!.status).toBe("matched");
  expect(room!.matchedQuestId).toBe(a);
});

// Correction 4. A guest who double-submits `rooms.join` before any session key
// reaches their phone leaves a member row NOBODY holds the key for. It cannot
// swipe and it cannot leave, so it blocks unanimity and exhaustion alike -- and
// the match may never deadlock. The host is the one person present who can
// clear it.
test("the host removing a stuck member unblocks a room that was waiting on it", async () => {
  const t = convexTest(schema, modules);
  const { roomId, a, b, samId } = await threePersonRoom(t, "k-orphan-nobody-holds");
  await exhaustTheDeck(t, [a, b]);
  expect((await t.run(async (ctx) => ctx.db.get(roomId)))!.status).toBe("swiping");

  await t.mutation(api.rooms.removeMember, {
    code: "3333", sessionKey: "k-bec", memberId: samId,
  });

  const room = await t.run(async (ctx) => ctx.db.get(roomId));
  expect(room!.status).toBe("matched");
  expect(room!.matchedQuestId).toBe(a);
  const roster = await t.run(async (ctx) =>
    ctx.db.query("members").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect(),
  );
  expect(roster.map((m) => m.name).sort()).toEqual(["Bec", "Tam"]);
});
