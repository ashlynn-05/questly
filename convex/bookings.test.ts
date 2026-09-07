/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const START = 1_800_000_000_000;

// This file drives a real match and then runs the scheduled `plans.generate`,
// which reaches OpenAI for real. Unstubbed, on any machine that happens to have
// OPENAI_API_KEY set -- a reviewer's laptop, CI -- `npm test` was making a live
// billable call, and `generate` swallows failures by design so nothing ever
// said so. No key, and a `fetch` that shouts if anything tries the wire.
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

async function matchedRoom(
  t: T,
  over: { mapsUri?: string; locked?: boolean; members?: string[] } = {},
) {
  const names = over.members ?? ["Bec", "Tam"];
  const ids = await t.run(async (ctx) => {
    const roomId = await ctx.db.insert("rooms", {
      hostUserId: "u1", mood: "treat", headcount: names.length, budgetPerHeadCents: 3000,
      whenAt: START, centreLat: -37.8, centreLng: 144.96, radiusKm: 5,
      visibility: "private", status: "matched", code: "6666",
    });
    for (const [i, name] of names.entries()) {
      await ctx.db.insert("members", {
        roomId, name, isHost: i === 0, sessionKey: `k-${name.toLowerCase()}`, joinedAt: i + 1,
      });
    }
    const questId = await ctx.db.insert("quests", {
      roomId, rank: 0, source: "places", placeId: "p", title: "The Long Weekend", blurb: "",
      priceLabel: "$14", priceCents: 1400, distanceKm: 1, discountPct: 0,
      mapsUri: over.mapsUri, score: 1, scoreBreakdown: {},
    });
    await ctx.db.patch(roomId, { matchedQuestId: questId });
    return { roomId, questId };
  });

  // Through the lease, exactly as `plans.generate` does -- a plan write without
  // one is refused, and seeding around that would test a path nothing uses.
  const token = await t.mutation(internal.plans.markGenerating, { roomId: ids.roomId });
  await t.mutation(internal.plans.writePlan, {
    roomId: ids.roomId, questId: ids.questId, token: token as string,
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

test("booking closes the proposals the room had open, rather than leaving them live", async () => {
  const t = convexTest(schema, modules);
  await matchedRoom(t);
  // Two members, so the proposer's own yes is not yet a majority.
  const { proposalId, accepted } = await t.mutation(api.proposals.open, {
    code: "6666", sessionKey: "k-bec", stopId: "s1",
    replacement: REPLACEMENT, reason: "second thoughts",
  });
  expect(accepted).toBe(false);

  await t.mutation(api.bookings.confirm, { code: "6666", sessionKey: "k-tam" });

  // Closed without applying: a booked room has nothing left to decide, and a
  // proposal left open is a swap waiting for the roster to shrink under it.
  const proposal = await t.run(async (ctx) => ctx.db.get(proposalId));
  expect(proposal!.status).toBe("rejected");

  // So a late vote reports the outcome rather than carrying anything.
  const late = await t.mutation(api.proposals.vote, {
    code: "6666", sessionKey: "k-tam", proposalId, vote: "yes",
  });
  expect(late.accepted).toBe(false);

  const plan = await t.run(async (ctx) => ctx.db.query("plans").first());
  expect(plan!.stops[0].name).toBe("The Long Weekend");
});

/**
 * Defence in depth. Booking closes every proposal it can see, so this state
 * should not arise -- but the guard in `proposals.vote` is what protects the
 * plan from the next path someone adds, so it is tested directly rather than
 * left to be reachable only through a bug.
 */
test("an open proposal in a booked room cannot be voted through", async () => {
  const t = convexTest(schema, modules);
  const { roomId } = await matchedRoom(t);
  await t.mutation(api.bookings.confirm, { code: "6666", sessionKey: "k-bec" });

  const proposalId = await t.run(async (ctx) => {
    const bec = await ctx.db
      .query("members")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .first();
    return await ctx.db.insert("proposals", {
      roomId, stopId: "s1", proposedBy: bec!._id,
      replacement: REPLACEMENT, reason: "smuggled in", status: "open",
    });
  });

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

// --- the fifth door: a shrinking roster ----------------------------------
//
// The freeze is not a property of four functions, it is a property of every
// path that can write a plan. `rooms.leave` / `rooms.removeMember` reach one
// through `detachMember` -> `resolveOpenProposals` -> `applyStopSwap`, and a
// smaller roster is a smaller majority: a proposal one yes short at booking
// time PASSES the moment a member walks away.

/** Bec proposes and Tam agrees (2 of the 3 needed); Jo objects; Ali is silent. */
async function bookedRoomWithADisputedStop(t: T) {
  const { roomId } = await matchedRoom(t, { members: ["Bec", "Tam", "Ali", "Jo"] });

  const { proposalId, accepted } = await t.mutation(api.proposals.open, {
    code: "6666", sessionKey: "k-bec", stopId: "s1",
    replacement: REPLACEMENT, reason: "second thoughts",
  });
  await t.mutation(api.proposals.vote, {
    code: "6666", sessionKey: "k-tam", proposalId, vote: "yes",
  });
  await t.mutation(api.proposals.vote, {
    code: "6666", sessionKey: "k-jo", proposalId, vote: "no",
  });
  // needed(4) is 3 and there are 2 yeses, so it is genuinely still undecided.
  expect(accepted).toBe(false);
  const open = await t.run(async (ctx) => ctx.db.get(proposalId));
  expect(open!.status).toBe("open");

  const booking = await t.mutation(api.bookings.confirm, {
    code: "6666", sessionKey: "k-bec",
  });
  return { roomId, proposalId, booking };
}

test("a member leaving after the booking cannot carry the proposal the room left open", async () => {
  const t = convexTest(schema, modules);
  const { roomId, proposalId } = await bookedRoomWithADisputedStop(t);

  const before = await t.run(async (ctx) => ctx.db.query("plans").first());
  const jo = await t.run(async (ctx) =>
    (await ctx.db.query("members").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect())
      .find((m) => m.name === "Jo")!,
  );

  // Jo voted no and never gets to change that by leaving: the roster drops to
  // 3, needed(3) is 2, and the 2 yeses would carry the swap.
  await t.mutation(api.rooms.leave, { code: "6666", sessionKey: "k-jo" });

  const after = await t.run(async (ctx) => ctx.db.query("plans").first());
  expect(after!.stops).toEqual(before!.stops);
  expect(after!.stops[0].name).toBe("The Long Weekend");
  expect(after!.totalPerHeadCents).toBe(before!.totalPerHeadCents);

  // The booking still describes the plan it was made against.
  const booking = await t.run(async (ctx) => ctx.db.query("bookings").first());
  expect(booking!.totalCents).toBe(after!.totalPerHeadCents * booking!.headcount);

  // The proposal was closed by the booking, not carried by the departure.
  const proposal = await t.run(async (ctx) => ctx.db.get(proposalId));
  expect(proposal!.status).toBe("rejected");

  // Jo still took what counted for them with them. `detachMember` skips the
  // resolve step in a booked room; it must not skip the cleanup.
  const votes = await t.run(async (ctx) =>
    ctx.db.query("proposalVotes").withIndex("by_member", (q) => q.eq("memberId", jo._id)).collect(),
  );
  expect(votes).toEqual([]);
});

/**
 * The load-bearing half. Booking closes every proposal it can see, so the test
 * above passes on that fix alone -- this one puts an open proposal into a
 * booked room directly, which is what the next path someone adds would do by
 * accident, and proves `detachMember` refuses to resolve it.
 */
test("a departure never resolves a proposal in a booked room, however it got there", async () => {
  const t = convexTest(schema, modules);
  const { roomId } = await matchedRoom(t, { members: ["Bec", "Tam", "Ali", "Jo"] });
  await t.mutation(api.bookings.confirm, { code: "6666", sessionKey: "k-bec" });

  const proposalId = await t.run(async (ctx) => {
    const members = await ctx.db
      .query("members")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .collect();
    const id = await ctx.db.insert("proposals", {
      roomId, stopId: "s1", proposedBy: members[0]._id,
      replacement: REPLACEMENT, reason: "smuggled in", status: "open",
    });
    for (const name of ["Bec", "Tam"]) {
      await ctx.db.insert("proposalVotes", {
        proposalId: id, memberId: members.find((m) => m.name === name)!._id, vote: "yes",
      });
    }
    return id;
  });

  // Roster 4 -> 3, needed 3 -> 2, and there are exactly 2 yeses waiting.
  await t.mutation(api.rooms.leave, { code: "6666", sessionKey: "k-jo" });

  const plan = await t.run(async (ctx) => ctx.db.query("plans").first());
  expect(plan!.stops[0].name).toBe("The Long Weekend");
  expect(plan!.totalPerHeadCents).toBe(1400);

  // Untouched, not rejected: the room is booked, so nothing re-decided it.
  const proposal = await t.run(async (ctx) => ctx.db.get(proposalId));
  expect(proposal!.status).toBe("open");
});

// --- the sixth door: a plan build already in flight -----------------------
//
// `plans.generate` is SCHEDULED, so it is still in flight for a few seconds
// after the room matches. Booking inside that window used to be allowed, and
// the booking quoted the QUEST price -- one venue -- while the night the group
// could see was a whole itinerary. The reference said $28 and the plan said
// $40, and the plan that landed afterwards was then dropped to stop the two
// disagreeing further. Both halves of that are now gone: you cannot book a
// night that has not been written yet.

test("booking is refused until the plan the group can see actually exists", async () => {
  const t = convexTest(schema, modules);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.useFakeTimers();
  try {
    const questId = await t.run(async (ctx) => {
      const roomId = await ctx.db.insert("rooms", {
        hostUserId: "u1", mood: "treat", headcount: 2, budgetPerHeadCents: 3000,
        whenAt: START, centreLat: -37.8, centreLng: 144.96, radiusKm: 5,
        visibility: "private", status: "swiping", code: "9191",
      });
      await ctx.db.insert("members", { roomId, name: "Bec", isHost: true, sessionKey: "k-bec", joinedAt: 1 });
      await ctx.db.insert("members", { roomId, name: "Tam", isHost: false, sessionKey: "k-tam", joinedAt: 2 });
      return await ctx.db.insert("quests", {
        roomId, rank: 0, source: "places", placeId: "p", title: "The Long Weekend", blurb: "",
        priceLabel: "$14", priceCents: 1400, distanceKm: 1, discountPct: 0,
        score: 1, scoreBreakdown: {},
      });
    });

    // Unanimous, so the room matches and schedules `plans.generate` -- which
    // has not run yet.
    await t.mutation(api.swipes.cast, { code: "9191", sessionKey: "k-bec", questId, dir: "yes" });
    const { matched } = await t.mutation(api.swipes.cast, {
      code: "9191", sessionKey: "k-tam", questId, dir: "yes",
    });
    expect(matched).toBe(true);
    expect(await t.run(async (ctx) => ctx.db.query("plans").first())).toBeNull();

    // Inside that window there is nothing to quote, so the answer is a sentence
    // asking them to wait -- not a reference for a night nobody has written.
    await expectUserError(
      t.mutation(api.bookings.confirm, { code: "9191", sessionKey: "k-bec" }),
      "PLAN_NOT_READY",
      /still being written/i,
    );
    expect(await t.run(async (ctx) => ctx.db.query("bookings").first())).toBeNull();

    // Now let the build finish. `finishInProgressScheduledFunctions` does not
    // run a runAfter(0) job in convex-test 0.0.56; this does. No OPENAI_API_KEY
    // is set, so this is the canned night and never touches the wire.
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const plan = await t.run(async (ctx) => ctx.db.query("plans").first());
    expect(plan).not.toBeNull();

    // And now the booking totals the night the group is actually looking at.
    await t.mutation(api.bookings.confirm, { code: "9191", sessionKey: "k-bec" });
    const booking = await t.run(async (ctx) => ctx.db.query("bookings").first());
    expect(booking!.totalCents).toBe(plan!.totalPerHeadCents * 2);
  } finally {
    vi.useRealTimers();
    vi.restoreAllMocks();
  }
});
