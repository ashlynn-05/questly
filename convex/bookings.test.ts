/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const START = 1_800_000_000_000;

/**
 * The schema-aware handle. `ReturnType<typeof convexTest>` silently drops the
 * schema types, which leaves vitest green while `tsc` reports errors.
 */
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

async function matchedRoom(t: T, over: { mapsUri?: string; locked?: boolean } = {}) {
  const ids = await t.run(async (ctx) => {
    const roomId = await ctx.db.insert("rooms", {
      hostUserId: "u1", mood: "treat", headcount: 2, budgetPerHeadCents: 3000,
      whenAt: START, centreLat: -37.8, centreLng: 144.96, radiusKm: 5,
      visibility: "private", status: "matched", code: "6666",
    });
    await ctx.db.insert("members", { roomId, name: "Bec", isHost: true, sessionKey: "k-bec", joinedAt: 1 });
    await ctx.db.insert("members", { roomId, name: "Tam", isHost: false, sessionKey: "k-tam", joinedAt: 2 });
    const questId = await ctx.db.insert("quests", {
      roomId, rank: 0, source: "places", placeId: "p", title: "The Long Weekend", blurb: "",
      priceLabel: "$14", priceCents: 1400, distanceKm: 1, discountPct: 0,
      mapsUri: over.mapsUri, score: 1, scoreBreakdown: {},
    });
    await ctx.db.patch(roomId, { matchedQuestId: questId });
    return { roomId, questId };
  });

  await t.mutation(internal.plans.writePlan, {
    roomId: ids.roomId, questId: ids.questId,
    stops: [{
      id: "s1", slot: "main", name: "The Long Weekend", startAt: START, durationMin: 60,
      costPerHeadCents: 1400, note: "", source: "llm", locked: over.locked ?? false,
    }],
    shareMessage: "x",
  });
  return ids;
}

const REPLACEMENT = {
  id: "s1", slot: "main" as const, name: "Somewhere else", startAt: START, durationMin: 60,
  costPerHeadCents: 1000, note: "", source: "manual" as const, locked: false,
};

test("confirming produces a reference and totals the whole party", async () => {
  const t = convexTest(schema, modules);
  const { roomId } = await matchedRoom(t);
  const { ref } = await t.mutation(api.bookings.confirm, { code: "6666", sessionKey: "k-bec" });
  expect(ref).toBe("QL-6666");

  const booking = await t.run(async (ctx) =>
    ctx.db.query("bookings").withIndex("by_room", (q) => q.eq("roomId", roomId)).unique(),
  );
  expect(booking!.totalCents).toBe(2800); // $14 each, two members
  expect(booking!.headcount).toBe(2);
  expect(booking!.status).toBe("simulated");
});

test("the deep link uses the venue's Maps URI when there is one", async () => {
  const t = convexTest(schema, modules);
  await matchedRoom(t, { mapsUri: "https://maps.google.com/?cid=123" });
  const { deepLink } = await t.mutation(api.bookings.confirm, { code: "6666", sessionKey: "k-bec" });
  expect(deepLink).toBe("https://maps.google.com/?cid=123");
});

test("without a Maps URI the deep link falls back to a search for the venue", async () => {
  const t = convexTest(schema, modules);
  await matchedRoom(t);
  const { deepLink } = await t.mutation(api.bookings.confirm, { code: "6666", sessionKey: "k-bec" });
  expect(deepLink).toContain("google.com/maps/search");
  expect(deepLink).toContain("Long");
});

test("confirming twice returns the same booking rather than a second one", async () => {
  const t = convexTest(schema, modules);
  await matchedRoom(t);
  const first = await t.mutation(api.bookings.confirm, { code: "6666", sessionKey: "k-bec" });
  const second = await t.mutation(api.bookings.confirm, { code: "6666", sessionKey: "k-tam" });
  expect(second.ref).toBe(first.ref);

  const all = await t.run(async (ctx) => ctx.db.query("bookings").collect());
  expect(all).toHaveLength(1);
});

test("confirming moves the room to booked", async () => {
  const t = convexTest(schema, modules);
  const { roomId } = await matchedRoom(t);
  await t.mutation(api.bookings.confirm, { code: "6666", sessionKey: "k-bec" });
  const room = await t.run(async (ctx) => ctx.db.get(roomId));
  expect(room!.status).toBe("booked");
});

test("any member can book, not only the host", async () => {
  const t = convexTest(schema, modules);
  await matchedRoom(t);
  const { ref } = await t.mutation(api.bookings.confirm, { code: "6666", sessionKey: "k-tam" });
  expect(ref).toBe("QL-6666");
});

test("a non-member cannot book", async () => {
  const t = convexTest(schema, modules);
  await matchedRoom(t);
  await expectUserError(
    t.mutation(api.bookings.confirm, { code: "6666", sessionKey: "k-nobody" }),
    "NOT_A_MEMBER",
    /not a member/i,
  );
});

test("a room with no match cannot be booked", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const roomId = await ctx.db.insert("rooms", {
      hostUserId: "u1", mood: "treat", headcount: 1, budgetPerHeadCents: 0,
      whenAt: START, centreLat: 0, centreLng: 0, radiusKm: 5,
      visibility: "private", status: "swiping", code: "7777",
    });
    await ctx.db.insert("members", { roomId, name: "Bec", isHost: true, sessionKey: "k", joinedAt: 1 });
  });
  await expectUserError(
    t.mutation(api.bookings.confirm, { code: "7777", sessionKey: "k" }),
    "NOTHING_TO_BOOK",
    /nothing to book/i,
  );
});

// --- a booked plan is frozen ---------------------------------------------
//
// The group is holding a reference to a specific itinerary once they have
// booked. Every path that could change it out from under them is refused.

test("a stop cannot be locked once the night is booked", async () => {
  const t = convexTest(schema, modules);
  await matchedRoom(t);
  await t.mutation(api.bookings.confirm, { code: "6666", sessionKey: "k-bec" });

  await expectUserError(
    t.mutation(api.plans.setLocked, {
      code: "6666", sessionKey: "k-bec", stopId: "s1", locked: true,
    }),
    "ROOM_BOOKED",
    /booked/i,
  );
});

test("unlocking is refused after booking too, not only locking", async () => {
  const t = convexTest(schema, modules);
  await matchedRoom(t, { locked: true });
  await t.mutation(api.bookings.confirm, { code: "6666", sessionKey: "k-bec" });

  // Releasing a lock after the booking reopens the swap path by another door,
  // so it is refused for the same reason the swap itself is.
  await expectUserError(
    t.mutation(api.plans.setLocked, {
      code: "6666", sessionKey: "k-bec", stopId: "s1", locked: false,
    }),
    "ROOM_BOOKED",
    /booked/i,
  );

  const plan = await t.run(async (ctx) => ctx.db.query("plans").first());
  expect(plan!.stops[0].locked).toBe(true);
});

test("a stop cannot be swapped directly once the night is booked", async () => {
  const t = convexTest(schema, modules);
  await matchedRoom(t);
  await t.mutation(api.bookings.confirm, { code: "6666", sessionKey: "k-bec" });

  // Refused as ROOM_BOOKED, not as GROUP_NEEDS_PROPOSAL: the booking gate runs
  // first, so a room of one gets the same answer this room of two does.
  await expectUserError(
    t.mutation(api.plans.replaceStop, {
      code: "6666", sessionKey: "k-bec", stopId: "s1", replacement: REPLACEMENT,
    }),
    "ROOM_BOOKED",
    /booked/i,
  );

  const plan = await t.run(async (ctx) => ctx.db.query("plans").first());
  expect(plan!.stops[0].name).toBe("The Long Weekend");
});

test("no new proposal can be opened once the night is booked", async () => {
  const t = convexTest(schema, modules);
  await matchedRoom(t);
  await t.mutation(api.bookings.confirm, { code: "6666", sessionKey: "k-bec" });

  await expectUserError(
    t.mutation(api.proposals.open, {
      code: "6666", sessionKey: "k-bec", stopId: "s1",
      replacement: REPLACEMENT, reason: "second thoughts",
    }),
    "ROOM_BOOKED",
    /booked/i,
  );
});

test("a proposal opened before the booking can no longer be voted through", async () => {
  const t = convexTest(schema, modules);
  await matchedRoom(t);
  // Two members, so the proposer's own yes is not yet a majority.
  const { proposalId, accepted } = await t.mutation(api.proposals.open, {
    code: "6666", sessionKey: "k-bec", stopId: "s1",
    replacement: REPLACEMENT, reason: "second thoughts",
  });
  expect(accepted).toBe(false);

  await t.mutation(api.bookings.confirm, { code: "6666", sessionKey: "k-tam" });

  await expectUserError(
    t.mutation(api.proposals.vote, {
      code: "6666", sessionKey: "k-tam", proposalId, vote: "yes",
    }),
    "ROOM_BOOKED",
    /booked/i,
  );

  const plan = await t.run(async (ctx) => ctx.db.query("plans").first());
  expect(plan!.stops[0].name).toBe("The Long Weekend");
});

/**
 * The freeze stops NEW decisions, not the reporting of an old one. Two phones
 * submitting a vote at nearly the same moment is the normal case, and the loser
 * of that race is owed the outcome rather than an error -- which stays true
 * after the booking, because the decision was already made before it.
 */
test("a proposal the room already carried still reports its outcome after booking", async () => {
  const t = convexTest(schema, modules);
  await matchedRoom(t);
  const { proposalId } = await t.mutation(api.proposals.open, {
    code: "6666", sessionKey: "k-bec", stopId: "s1",
    replacement: REPLACEMENT, reason: "second thoughts",
  });
  // Two members, so Tam's yes is the majority and the swap lands.
  const decided = await t.mutation(api.proposals.vote, {
    code: "6666", sessionKey: "k-tam", proposalId, vote: "yes",
  });
  expect(decided.accepted).toBe(true);

  await t.mutation(api.bookings.confirm, { code: "6666", sessionKey: "k-bec" });

  // The late re-send reports, it does not throw ROOM_BOOKED.
  const late = await t.mutation(api.proposals.vote, {
    code: "6666", sessionKey: "k-bec", proposalId, vote: "yes",
  });
  expect(late.accepted).toBe(true);

  // And it changed nothing: the room booked the swapped-in stop.
  const plan = await t.run(async (ctx) => ctx.db.query("plans").first());
  expect(plan!.stops[0].name).toBe("Somewhere else");
});

test("a plan with locked stops books normally", async () => {
  const t = convexTest(schema, modules);
  await matchedRoom(t, { locked: true });
  // Locking pins a stop; it must not be mistaken for a reason the night cannot
  // be booked. The lock is the group agreeing, which is the point of booking.
  const { ref } = await t.mutation(api.bookings.confirm, { code: "6666", sessionKey: "k-bec" });
  expect(ref).toBe("QL-6666");

  const booking = await t.run(async (ctx) => ctx.db.query("bookings").first());
  expect(booking!.totalCents).toBe(2800);
});
