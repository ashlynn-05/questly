/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { MAX_ROOM_MEMBERS } from "./lib/access";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");

/**
 * Every user-facing throw must arrive as a `ConvexError` carrying a stable
 * `code`, not just prose a copywriter could later change out from under a
 * regex. This asserts both.
 */
async function expectUserError(promise: Promise<unknown>, code: string, messagePattern: RegExp) {
  await expect(promise).rejects.toBeInstanceOf(ConvexError);
  await expect(promise).rejects.toMatchObject({
    data: { code, message: expect.stringMatching(messagePattern) },
  });
}

const CREATE = {
  mood: "grass" as const,
  headcount: 4,
  budgetPerHeadCents: 0,
  whenAt: 1_800_000_000_000,
  centreLat: -37.8,
  centreLng: 144.96,
  radiusKm: 5,
  visibility: "private" as const,
  hostName: "Bec",
};

test("creating a room returns a code and makes the creator the host", async () => {
  const t = convexTest(schema, modules);
  const asUser = t.withIdentity({ subject: "u1", name: "Bec" });
  const { code, sessionKey } = await asUser.mutation(api.rooms.create, CREATE);
  expect(code).toMatch(/^\d{4}$/);

  const view = await asUser.query(api.rooms.get, { code, sessionKey });
  expect(view!.members).toHaveLength(1);
  expect(view!.members[0]).toMatchObject({ name: "Bec", isHost: true });
  expect(view!.you.isHost).toBe(true);
  expect(view!.room.status).toBe("lobby");
});

test("a guest joins with a first name and no account", async () => {
  const t = convexTest(schema, modules);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
  const { code } = await asHost.mutation(api.rooms.create, CREATE);

  // No identity at all -- this is the whole point.
  const guest = await t.mutation(api.rooms.join, { code, name: "Tam" });
  expect(guest.sessionKey.length).toBeGreaterThanOrEqual(20);

  const view = await t.query(api.rooms.get, { code, sessionKey: guest.sessionKey });
  expect(view!.members.map((m) => m.name).sort()).toEqual(["Bec", "Tam"]);
  expect(view!.you.isHost).toBe(false);
});

test("rooms.get never leaks any member's session key", async () => {
  const t = convexTest(schema, modules);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
  const { code, sessionKey } = await asHost.mutation(api.rooms.create, CREATE);
  await t.mutation(api.rooms.join, { code, name: "Tam" });

  const view = await asHost.query(api.rooms.get, { code, sessionKey });
  // Prove the view is populated before asserting an absence: a null view, or an
  // empty roster, would satisfy the string check for entirely the wrong reason,
  // and a security assertion that can pass vacuously is not an assertion.
  expect(view).not.toBeNull();
  expect(view!.members).toHaveLength(2);
  expect(JSON.stringify(view)).not.toContain("sessionKey");
});

test("rooms.get returns null for a session key that is not in the room", async () => {
  const t = convexTest(schema, modules);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
  const { code } = await asHost.mutation(api.rooms.create, CREATE);
  expect(await t.query(api.rooms.get, { code, sessionKey: "not-a-key" })).toBeNull();
});

test("rooms.get returns null for an unknown code", async () => {
  const t = convexTest(schema, modules);
  expect(await t.query(api.rooms.get, { code: "9999", sessionKey: "x" })).toBeNull();
});

test("joining an unknown code fails clearly with ROOM_NOT_FOUND", async () => {
  const t = convexTest(schema, modules);
  await expectUserError(
    t.mutation(api.rooms.join, { code: "9999", name: "Tam" }),
    "ROOM_NOT_FOUND",
    /no room/i,
  );
});

test("a blank name cannot join, and fails with FIELD_REQUIRED", async () => {
  const t = convexTest(schema, modules);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
  const { code } = await asHost.mutation(api.rooms.create, CREATE);
  await expectUserError(
    t.mutation(api.rooms.join, { code, name: "   " }),
    "FIELD_REQUIRED",
    /name/i,
  );
});

// Correction 1: the roster freezes the moment the room leaves the lobby. A late
// joiner would silently raise the unanimity denominator mid-deck, so every
// non-lobby status is closed, not just "booked".
test("a room that has left the lobby is closed to new joiners", async () => {
  const t = convexTest(schema, modules);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
  const { code } = await asHost.mutation(api.rooms.create, CREATE);

  for (const status of ["building", "swiping", "matched", "booked"] as const) {
    await t.run(async (ctx) => {
      const room = await ctx.db
        .query("rooms")
        .withIndex("by_code", (q) => q.eq("code", code))
        .unique();
      await ctx.db.patch(room!._id, { status });
    });
    await expectUserError(
      t.mutation(api.rooms.join, { code, name: "Tam" }),
      "ROOM_CLOSED",
      /already started/i,
    );
  }
});

test("a signed-in user re-joining a room they are already in gets their existing membership", async () => {
  const t = convexTest(schema, modules);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
  const { code, sessionKey } = await asHost.mutation(api.rooms.create, CREATE);

  // The host typing their own room code, twice.
  const again = await asHost.mutation(api.rooms.join, { code, name: "Bec" });
  const third = await asHost.mutation(api.rooms.join, { code, name: "Bec" });

  expect(again.sessionKey).toBe(sessionKey);
  expect(third.sessionKey).toBe(sessionKey);

  const view = await asHost.query(api.rooms.get, { code, sessionKey });
  expect(view!.members).toHaveLength(1);
  expect(view!.members[0].isHost).toBe(true);
});

test("a guest re-joining with the key they were issued gets their existing membership", async () => {
  const t = convexTest(schema, modules);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
  const { code, sessionKey } = await asHost.mutation(api.rooms.create, CREATE);
  const guest = await t.mutation(api.rooms.join, { code, name: "Tam" });

  // A refresh: the client sends back the key it was issued.
  const again = await t.mutation(api.rooms.join, {
    code, name: "Tam", sessionKey: guest.sessionKey,
  });
  expect(again.sessionKey).toBe(guest.sessionKey);

  const view = await asHost.query(api.rooms.get, { code, sessionKey });
  expect(view!.members).toHaveLength(2);
});

test("an existing member can re-enter after the room has left the lobby", async () => {
  const t = convexTest(schema, modules);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
  const { code, sessionKey } = await asHost.mutation(api.rooms.create, CREATE);
  const guest = await t.mutation(api.rooms.join, { code, name: "Tam" });

  await t.run(async (ctx) => {
    const room = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", code)).unique();
    await ctx.db.patch(room!._id, { status: "swiping" });
  });

  // The lobby gate exists to freeze the denominator, not to lock a member out
  // of the room they are already swiping in.
  const again = await t.mutation(api.rooms.join, {
    code, name: "Tam", sessionKey: guest.sessionKey,
  });
  expect(again.sessionKey).toBe(guest.sessionKey);

  const view = await asHost.query(api.rooms.get, { code, sessionKey });
  expect(view!.members).toHaveLength(2);
});

test("an accountless guest with no prior key is a new person each time", async () => {
  const t = convexTest(schema, modules);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
  const { code, sessionKey } = await asHost.mutation(api.rooms.create, CREATE);

  // Documented and deliberate: two friends both called Tam are indistinguishable
  // from one Tam joining twice, and merging them would silently drop a real
  // person from the roster.
  const first = await t.mutation(api.rooms.join, { code, name: "Tam" });
  const second = await t.mutation(api.rooms.join, { code, name: "Tam" });
  expect(second.sessionKey).not.toBe(first.sessionKey);

  const view = await asHost.query(api.rooms.get, { code, sessionKey });
  expect(view!.members).toHaveLength(3);
});

test("a room cannot grow past the member cap", async () => {
  const t = convexTest(schema, modules);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
  // headcount set above MAX_ROOM_MEMBERS so this exercises the absolute
  // ceiling, not the headcount gate covered separately below.
  const { code, sessionKey } = await asHost.mutation(api.rooms.create, {
    ...CREATE, headcount: MAX_ROOM_MEMBERS + 5,
  });

  // The host already occupies one seat.
  for (let i = 1; i < MAX_ROOM_MEMBERS; i++) {
    await t.mutation(api.rooms.join, { code, name: `Guest ${i}` });
  }

  const view = await asHost.query(api.rooms.get, { code, sessionKey });
  expect(view!.members).toHaveLength(MAX_ROOM_MEMBERS);

  await expect(t.mutation(api.rooms.join, { code, name: "One too many" })).rejects.toThrow(
    /full/i,
  );
});

// --- capacity: the room's own planned headcount, not just the absolute cap -

test("joining a room that has reached its headcount is refused with ROOM_FULL", async () => {
  const t = convexTest(schema, modules);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
  // headcount 2: the host plus one guest fills it.
  const { code, sessionKey } = await asHost.mutation(api.rooms.create, {
    ...CREATE, headcount: 2,
  });
  await t.mutation(api.rooms.join, { code, name: "Tam" });

  const view = await asHost.query(api.rooms.get, { code, sessionKey });
  expect(view!.members).toHaveLength(2);

  await expectUserError(
    t.mutation(api.rooms.join, { code, name: "One too many" }),
    "ROOM_FULL",
    /2/,
  );
});

test("a member of a full room re-joining with their sessionKey still gets their existing membership", async () => {
  const t = convexTest(schema, modules);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
  const { code, sessionKey } = await asHost.mutation(api.rooms.create, {
    ...CREATE, headcount: 2,
  });
  const guest = await t.mutation(api.rooms.join, { code, name: "Tam" });

  // The room is now exactly at its headcount. A stranger would be refused --
  // but the gate sits after the re-entry check, so the existing member is not.
  const again = await t.mutation(api.rooms.join, {
    code, name: "Tam", sessionKey: guest.sessionKey,
  });
  expect(again.sessionKey).toBe(guest.sessionKey);

  const view = await asHost.query(api.rooms.get, { code, sessionKey });
  expect(view!.members).toHaveLength(2);
});

test("open rooms are discoverable by mood, private rooms are not", async () => {
  const t = convexTest(schema, modules);
  const asA = t.withIdentity({ subject: "u1", name: "A" });
  const asB = t.withIdentity({ subject: "u2", name: "B" });
  await asA.mutation(api.rooms.create, { ...CREATE, visibility: "open", mood: "meet" });
  await asB.mutation(api.rooms.create, { ...CREATE, visibility: "private", mood: "meet" });

  const open = await t.query(api.rooms.openRooms, { mood: "meet" });
  expect(open).toHaveLength(1);
  expect(open[0].memberCount).toBe(1);
});

test("openRooms omits a room that has reached its headcount and keeps one that has not", async () => {
  const t = convexTest(schema, modules);
  const asA = t.withIdentity({ subject: "u1", name: "A" });
  const asB = t.withIdentity({ subject: "u2", name: "B" });

  // Full the moment it is created: headcount 1, one member (the host).
  const full = await asA.mutation(api.rooms.create, {
    ...CREATE, visibility: "open", mood: "meet", headcount: 1,
  });
  // Room for more.
  const open = await asB.mutation(api.rooms.create, {
    ...CREATE, visibility: "open", mood: "meet", headcount: 4,
  });

  const rooms = await t.query(api.rooms.openRooms, { mood: "meet" });
  expect(rooms.map((r) => r.code)).toEqual([open.code]);
  expect(rooms.map((r) => r.code)).not.toContain(full.code);
});

test("creating a room requires a signed-in host, and fails with NOT_SIGNED_IN", async () => {
  const t = convexTest(schema, modules);
  await expectUserError(t.mutation(api.rooms.create, CREATE), "NOT_SIGNED_IN", /signed in/i);
});

test("create surfaces NO_FREE_ROOM_CODE when every generated code collides", async () => {
  const t = convexTest(schema, modules);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });

  // Seed a room at the one code our mocked RNG will ever produce, so every
  // retry inside rooms.create finds it taken.
  await t.run(async (ctx) => {
    await ctx.db.insert("rooms", {
      hostUserId: "other", mood: "grass", headcount: 2, budgetPerHeadCents: 0,
      whenAt: 1, centreLat: 0, centreLng: 0, radiusKm: 5,
      visibility: "private", status: "lobby", code: "0000",
    });
  });

  const spy = vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(<
    T extends ArrayBufferView | null,
  >(
    array: T,
  ): T => {
    if (array) new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(0);
    return array;
  });

  try {
    await expectUserError(
      asHost.mutation(api.rooms.create, CREATE),
      "NO_FREE_ROOM_CODE",
      /free room code/i,
    );
  } finally {
    spy.mockRestore();
  }
});

test("leaving removes you from the roster", async () => {
  const t = convexTest(schema, modules);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
  const { code, sessionKey } = await asHost.mutation(api.rooms.create, CREATE);
  const guest = await t.mutation(api.rooms.join, { code, name: "Tam" });

  await t.mutation(api.rooms.leave, { code, sessionKey: guest.sessionKey });

  const view = await asHost.query(api.rooms.get, { code, sessionKey });
  expect(view!.members.map((m) => m.name)).toEqual(["Bec"]);
});

test("leaving takes your swipes with you, so unanimity is judged on who is here", async () => {
  const t = convexTest(schema, modules);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
  const { code } = await asHost.mutation(api.rooms.create, CREATE);
  const guest = await t.mutation(api.rooms.join, { code, name: "Tam" });

  const { roomId, memberId } = await t.run(async (ctx) => {
    const room = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", code)).unique();
    const member = await ctx.db
      .query("members")
      .withIndex("by_room_session", (q) => q.eq("roomId", room!._id).eq("sessionKey", guest.sessionKey))
      .unique();
    const questId = await ctx.db.insert("quests", {
      roomId: room!._id, rank: 0, source: "places", placeId: "p", title: "T", blurb: "",
      priceLabel: "Free", priceCents: 0, distanceKm: 1, discountPct: 0, score: 1, scoreBreakdown: {},
    });
    await ctx.db.insert("swipes", {
      roomId: room!._id, questId, memberId: member!._id, dir: "no",
    });
    return { roomId: room!._id, memberId: member!._id };
  });

  await t.mutation(api.rooms.leave, { code, sessionKey: guest.sessionKey });

  const swipes = await t.run(async (ctx) => ctx.db.query("swipes").collect());
  expect(swipes).toHaveLength(0);

  // Correction 2: assert the leaver's own rows are gone, rather than re-asserting
  // that a just-created id exists.
  const leaverSwipes = await t.run(async (ctx) =>
    ctx.db
      .query("swipes")
      .withIndex("by_room_member", (q) => q.eq("roomId", roomId).eq("memberId", memberId))
      .collect(),
  );
  expect(leaverSwipes).toEqual([]);
});

test("leaving takes your proposal votes with you", async () => {
  const t = convexTest(schema, modules);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
  const { code, sessionKey } = await asHost.mutation(api.rooms.create, CREATE);
  const guest = await t.mutation(api.rooms.join, { code, name: "Tam" });
  let hostId!: Id<"members">;

  await t.run(async (ctx) => {
    const room = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", code)).unique();
    const members = await ctx.db
      .query("members")
      .withIndex("by_room", (q) => q.eq("roomId", room!._id))
      .collect();
    const host = members.find((m) => m.isHost)!;
    const leaver = members.find((m) => m.sessionKey === guest.sessionKey)!;
    hostId = host._id;

    // A real plan to edit, so the proposal's resolution below is the genuine
    // accept path rather than "there was nothing to swap".
    const questId = await ctx.db.insert("quests", {
      roomId: room!._id, rank: 0, source: "places", placeId: "p", title: "T", blurb: "",
      priceLabel: "Free", priceCents: 0, distanceKm: 1, discountPct: 0, score: 1, scoreBreakdown: {},
    });
    await ctx.db.insert("plans", {
      roomId: room!._id, questId, totalPerHeadCents: 0, shareMessage: "x",
      stops: [{
        id: "s1", slot: "main", name: "The bench", startAt: CREATE.whenAt, durationMin: 60,
        costPerHeadCents: 0, note: "", source: "llm", locked: false,
      }],
    });

    const proposalId = await ctx.db.insert("proposals", {
      roomId: room!._id, stopId: "s1", proposedBy: host._id, status: "open", reason: "closer",
      replacement: {
        id: "s1", slot: "main", name: "Other bar", startAt: 1, durationMin: 60,
        costPerHeadCents: 0, note: "", source: "manual", locked: false,
      },
    });
    // The two votes are deliberately different so the surviving row can only
    // be the host's if `detachMember` deleted the right one. If it deleted the
    // host's vote instead, a lone "no" would survive and this assertion would
    // catch it -- with both votes "yes", either outcome leaves a "yes" behind
    // and the test could not tell the difference.
    await ctx.db.insert("proposalVotes", { proposalId, memberId: host._id, vote: "yes" });
    await ctx.db.insert("proposalVotes", { proposalId, memberId: leaver._id, vote: "no" });
  });

  await t.mutation(api.rooms.leave, { code, sessionKey: guest.sessionKey });

  const votes = await t.run(async (ctx) => ctx.db.query("proposalVotes").collect());
  expect(votes).toHaveLength(1);

  expect(votes[0].memberId).toBe(hostId);
  expect(votes[0].vote).toBe("yes");

  // ...and the proposal does not hang. The roster it needed a majority of has
  // shrunk to one, the host's yes already IS that majority, and nobody is left
  // to cast the vote it would otherwise be waiting for -- so `rooms.leave`
  // re-resolves it on the remaining roster and the swap lands. See
  // convex/proposals.test.ts for the full re-resolution behaviour.
  const view = await asHost.query(api.rooms.get, { code, sessionKey });
  expect(view!.proposals).toEqual([]);
  expect(view!.plan!.stops[0].name).toBe("Other bar");
});

test("the host cannot leave their own room, and fails with HOST_CANNOT_LEAVE", async () => {
  const t = convexTest(schema, modules);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
  const { code, sessionKey } = await asHost.mutation(api.rooms.create, CREATE);
  await expectUserError(
    t.mutation(api.rooms.leave, { code, sessionKey }),
    "HOST_CANNOT_LEAVE",
    /host/i,
  );
});

// --- the host's escape hatch ----------------------------------------------
//
// `rooms.join` deliberately gives an unrecognisable guest a fresh row rather
// than merging two people called Tam into one member. The cost is a row nobody
// holds the session key for, which can neither swipe nor leave. The host can
// clear it. `memberId` here is a TARGET, never a credential: the authority is
// the caller's own sessionKey.

/** The member row a session key stands for. */
const memberIdOf = (t: TestConvex<typeof schema>, code: string, sessionKey: string) =>
  t.run(async (ctx) => {
    const room = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", code)).unique();
    const member = await ctx.db
      .query("members")
      .withIndex("by_room_session", (q) => q.eq("roomId", room!._id).eq("sessionKey", sessionKey))
      .unique();
    return member!._id;
  });

test("the host can remove a member, and their rows go with them", async () => {
  const t = convexTest(schema, modules);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
  const { code, sessionKey } = await asHost.mutation(api.rooms.create, CREATE);
  const guest = await t.mutation(api.rooms.join, { code, name: "Tam" });
  const memberId = await memberIdOf(t, code, guest.sessionKey);

  await t.mutation(api.rooms.removeMember, { code, sessionKey, memberId });

  const view = await asHost.query(api.rooms.get, { code, sessionKey });
  expect(view!.members.map((m) => m.name)).toEqual(["Bec"]);
  // Their key stops working, exactly as if they had left.
  expect(await t.query(api.rooms.get, { code, sessionKey: guest.sessionKey })).toBeNull();
});

test("a member who is not the host cannot remove anyone", async () => {
  const t = convexTest(schema, modules);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
  const { code, sessionKey } = await asHost.mutation(api.rooms.create, CREATE);
  const tam = await t.mutation(api.rooms.join, { code, name: "Tam" });
  await t.mutation(api.rooms.join, { code, name: "Sam" });
  const hostId = await memberIdOf(t, code, sessionKey);

  await expectUserError(
    t.mutation(api.rooms.removeMember, { code, sessionKey: tam.sessionKey, memberId: hostId }),
    "NOT_THE_HOST",
    /host/i,
  );
  const view = await asHost.query(api.rooms.get, { code, sessionKey });
  expect(view!.members).toHaveLength(3);
});

test("the host cannot remove themselves", async () => {
  const t = convexTest(schema, modules);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
  const { code, sessionKey } = await asHost.mutation(api.rooms.create, CREATE);
  const memberId = await memberIdOf(t, code, sessionKey);
  await expectUserError(
    t.mutation(api.rooms.removeMember, { code, sessionKey, memberId }),
    "HOST_CANNOT_LEAVE",
    /host/i,
  );
});

test("a host cannot remove a member of another room", async () => {
  const t = convexTest(schema, modules);
  const asBec = t.withIdentity({ subject: "u1", name: "Bec" });
  const asKim = t.withIdentity({ subject: "u2", name: "Kim" });
  const mine = await asBec.mutation(api.rooms.create, CREATE);
  const theirs = await asKim.mutation(api.rooms.create, { ...CREATE, hostName: "Kim" });
  const guest = await t.mutation(api.rooms.join, { code: theirs.code, name: "Tam" });
  const foreignId = await memberIdOf(t, theirs.code, guest.sessionKey);

  await expectUserError(
    t.mutation(api.rooms.removeMember, {
      code: mine.code, sessionKey: mine.sessionKey, memberId: foreignId,
    }),
    "NOT_A_MEMBER",
    /not in this room/i,
  );
  const view = await asKim.query(api.rooms.get, { code: theirs.code, sessionKey: theirs.sessionKey });
  expect(view!.members).toHaveLength(2);
});

test("a stranger's session key cannot remove anyone", async () => {
  const t = convexTest(schema, modules);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
  const { code, sessionKey } = await asHost.mutation(api.rooms.create, CREATE);
  const guest = await t.mutation(api.rooms.join, { code, name: "Tam" });
  const memberId = await memberIdOf(t, code, guest.sessionKey);

  await expectUserError(
    t.mutation(api.rooms.removeMember, { code, sessionKey: "k-nobody", memberId }),
    "NOT_A_MEMBER",
    /not a member/i,
  );
});
