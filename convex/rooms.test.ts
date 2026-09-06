/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

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

  await t.run(async (ctx) => {
    const room = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", code)).unique();
    const members = await ctx.db
      .query("members")
      .withIndex("by_room", (q) => q.eq("roomId", room!._id))
      .collect();
    const host = members.find((m) => m.isHost)!;
    const leaver = members.find((m) => m.sessionKey === guest.sessionKey)!;
    const proposalId = await ctx.db.insert("proposals", {
      roomId: room!._id, stopId: "s1", proposedBy: host._id, status: "open", reason: "closer",
      replacement: {
        id: "s1", slot: "main", name: "Other bar", startAt: 1, durationMin: 60,
        costPerHeadCents: 0, note: "", source: "manual", locked: false,
      },
    });
    await ctx.db.insert("proposalVotes", { proposalId, memberId: host._id, vote: "yes" });
    await ctx.db.insert("proposalVotes", { proposalId, memberId: leaver._id, vote: "yes" });
  });

  await t.mutation(api.rooms.leave, { code, sessionKey: guest.sessionKey });

  const votes = await t.run(async (ctx) => ctx.db.query("proposalVotes").collect());
  expect(votes).toHaveLength(1);

  // The remaining vote is the host's, and the open proposal is still visible.
  const view = await asHost.query(api.rooms.get, { code, sessionKey });
  expect(view!.proposals).toHaveLength(1);
  expect(view!.proposals[0]).toMatchObject({ yes: 1, needed: 1, youVoted: true });
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
