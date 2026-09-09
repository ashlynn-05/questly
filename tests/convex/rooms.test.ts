/// <reference types="vite/client" />
import { registerComponents } from "./testHelpers";
import { convexTest, type TestConvex } from "convex-test";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { MAX_ROOM_MEMBERS } from "../../convex/lib/rooms/access";
import type { Id } from "../../convex/_generated/dataModel";

const modules = import.meta.glob("../../convex/**/*.ts");
type OpenRoomsPage = FunctionReturnType<typeof api.rooms.openRoomsPage>;

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
  // A WEEK OUT, relative -- `rooms.create` now refuses a `whenAt` already past,
  // and this used to be the fixed 1_800_000_000_000, which is 2027-01-15. That
  // is future today and would have started failing every test in this file on
  // a date nobody would have connected to the guard.
  whenAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
  centreLat: -37.8,
  centreLng: 144.96,
  radiusKm: 5,
  visibility: "private" as const,
  hostName: "Bec",
};

test("creating a room returns a code and makes the creator the host", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asUser = t.withIdentity({ subject: "u1", name: "Bec" });
  const { code, sessionKey } = await asUser.mutation(api.rooms.create, CREATE);
  expect(code).toMatch(/^\d{4}$/);

  const view = await asUser.query(api.rooms.get, { code, sessionKey });
  expect(view!.members).toHaveLength(1);
  expect(view!.members[0]).toMatchObject({ name: "Bec", isHost: true });
  expect(view!.you.isHost).toBe(true);
  expect(view!.room.status).toBe("lobby");
});

// A room in the past is refused, and the refusal is the SERVER's -- the client
// says the same sentence sooner, but it is not the rule. This fires on the
// preset path too: "Tonight" resolves to 6:30pm today, which is already gone
// by 11pm, so the default option produced a past room before this guard.
test("a room whose time has already passed is refused, and no room is written", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asUser = t.withIdentity({ subject: "u1", name: "Bec" });

  await expectUserError(
    asUser.mutation(api.rooms.create, { ...CREATE, whenAt: Date.now() - 60_000 }),
    "WHEN_IN_THE_PAST",
    /already passed/i,
  );

  // Refused, and nothing half-written: no room, and no member row for a room
  // that does not exist.
  const rooms = await t.run(async (ctx) => await ctx.db.query("rooms").collect());
  expect(rooms).toHaveLength(0);
  const members = await t.run(async (ctx) => await ctx.db.query("members").collect());
  expect(members).toHaveLength(0);
});

test("the current instant is already too late, because a night starts at a time", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asUser = t.withIdentity({ subject: "u1", name: "Bec" });
  await expectUserError(
    asUser.mutation(api.rooms.create, { ...CREATE, whenAt: Date.now() }),
    "WHEN_IN_THE_PAST",
    /already passed/i,
  );
});

test("a guest joins with a first name and no account", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
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
  registerComponents(t);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
  const { code, sessionKey } = await asHost.mutation(api.rooms.create, CREATE);
  const guest = await t.mutation(api.rooms.join, { code, name: "Tam" });

  const view = await asHost.query(api.rooms.get, { code, sessionKey });
  // Prove the view is populated before asserting an absence: a null view, or an
  // empty roster, would satisfy the string check for entirely the wrong reason,
  // and a security assertion that can pass vacuously is not an assertion.
  expect(view).not.toBeNull();
  expect(view!.members).toHaveLength(2);

  // The keys themselves, not the field name. A projection that emitted another
  // member's key under some other label -- `token`, `k`, a bare array -- would
  // hand every capability in the room to whoever opened devtools, and a check
  // for the string "sessionKey" would have stayed green through it.
  const serialised = JSON.stringify(view);
  expect(serialised).not.toContain(guest.sessionKey);
  expect(serialised).not.toContain(sessionKey);
  expect(serialised).not.toContain("sessionKey");
});

test("rooms.get returns null for a session key that is not in the room", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
  const { code } = await asHost.mutation(api.rooms.create, CREATE);
  expect(await t.query(api.rooms.get, { code, sessionKey: "not-a-key" })).toBeNull();
});

test("rooms.get returns null for an unknown code", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  expect(await t.query(api.rooms.get, { code: "9999", sessionKey: "x" })).toBeNull();
});

test("joining an unknown code fails clearly with ROOM_NOT_FOUND", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  await expectUserError(
    t.mutation(api.rooms.join, { code: "9999", name: "Tam" }),
    "ROOM_NOT_FOUND",
    /no room/i,
  );
});

test("a blank name cannot join, and fails with FIELD_REQUIRED", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
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
  registerComponents(t);
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
  registerComponents(t);
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
  registerComponents(t);
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
  registerComponents(t);
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
  registerComponents(t);
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
  registerComponents(t);
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
  registerComponents(t);
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
  registerComponents(t);
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
  registerComponents(t);
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
  registerComponents(t);
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

test("openRoomsPage advances past a full first page to find an eligible room", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asHost = t.withIdentity({ subject: "u1", name: "A" });

  await asHost.mutation(api.rooms.create, {
    ...CREATE, visibility: "open", mood: "meet", headcount: 1,
  });
  const eligible = await asHost.mutation(api.rooms.create, {
    ...CREATE, visibility: "open", mood: "meet", headcount: 4,
  });

  const first = await t.query(api.rooms.openRoomsPage, {
    mood: "meet",
    paginationOpts: { numItems: 1, cursor: null },
  });
  expect(first.page).toEqual([]);
  expect(first.isDone).toBe(false);

  const second = await t.query(api.rooms.openRoomsPage, {
    mood: "meet",
    paginationOpts: { numItems: 1, cursor: first.continueCursor },
  });
  expect(second.page.map((room) => room.code)).toEqual([eligible.code]);
});

test("openRoomsPage excludes private, started, and wrong-mood rooms at the index", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asHost = t.withIdentity({ subject: "u1", name: "A" });
  const eligible = await asHost.mutation(api.rooms.create, {
    ...CREATE, visibility: "open", mood: "meet", headcount: 4,
  });
  await asHost.mutation(api.rooms.create, {
    ...CREATE, visibility: "private", mood: "meet", headcount: 4,
  });
  await asHost.mutation(api.rooms.create, {
    ...CREATE, visibility: "open", mood: "grass", headcount: 4,
  });
  const started = await asHost.mutation(api.rooms.create, {
    ...CREATE, visibility: "open", mood: "meet", headcount: 4,
  });
  await t.run(async (ctx) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", started.code))
      .unique();
    await ctx.db.patch(room!._id, { status: "swiping" });
  });

  const page = await t.query(api.rooms.openRoomsPage, {
    mood: "meet",
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(page.page.map((room) => room.code)).toEqual([eligible.code]);
  expect(page.isDone).toBe(true);
});

test("openRoomsPage keeps every eligible row across bounded pages", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asHost = t.withIdentity({ subject: "u1", name: "A" });
  await asHost.mutation(api.rooms.create, {
    ...CREATE, visibility: "open", mood: "meet", headcount: 1,
  });
  const eligible = await Promise.all(
    [4, 5, 6].map((headcount) =>
      asHost.mutation(api.rooms.create, {
        ...CREATE, visibility: "open", mood: "meet", headcount,
      }),
    ),
  );

  const found: string[] = [];
  let cursor: string | null = null;
  for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
    const page: OpenRoomsPage = await t.query(api.rooms.openRoomsPage, {
      mood: "meet",
      paginationOpts: { numItems: 1, cursor },
    });
    expect(page.page.length).toBeLessThanOrEqual(1);
    found.push(...page.page.map((room) => room.code));
    if (page.isDone) break;
    cursor = page.continueCursor;
  }

  expect(found).toEqual(eligible.map((room) => room.code));
});

test("openRoomsPage rejects an oversized page instead of accepting an unbounded read", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  await expectUserError(
    t.query(api.rooms.openRoomsPage, {
      mood: "meet",
      paginationOpts: { numItems: 21, cursor: null },
    }),
    "DISCOVERY_LIMIT",
    /at most 20/i,
  );
});

test("openRooms keeps the legacy summary shape", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asHost = t.withIdentity({ subject: "u1", name: "A" });
  const room = await asHost.mutation(api.rooms.create, {
    ...CREATE, visibility: "open", mood: "meet", headcount: 4,
  });

  await expect(t.query(api.rooms.openRooms, { mood: "meet" })).resolves.toEqual([
    {
      code: room.code,
      mood: "meet",
      headcount: 4,
      memberCount: 1,
      whenAt: CREATE.whenAt,
      demo: false,
    },
  ]);
});

test("openRooms reports its legacy capacity instead of truncating eligible rooms", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  await t.run(async (ctx) => {
    for (let i = 0; i <= 100; i++) {
      await ctx.db.insert("rooms", {
        hostUserId: `u${i}`,
        mood: "meet",
        headcount: 4,
        budgetPerHeadCents: 0,
        whenAt: CREATE.whenAt,
        centreLat: 0,
        centreLng: 0,
        radiusKm: 5,
        visibility: "open",
        status: "lobby",
        code: String(i).padStart(4, "0"),
      });
    }
  });

  await expectUserError(
    t.query(api.rooms.openRooms, { mood: "meet" }),
    "DISCOVERY_LIMIT",
    /more than 100/i,
  );
});

test("creating a room requires a signed-in host, and fails with NOT_SIGNED_IN", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  await expectUserError(t.mutation(api.rooms.create, CREATE), "NOT_SIGNED_IN", /signed in/i);
});

test("create surfaces NO_FREE_ROOM_CODE when every generated code collides", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
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
  registerComponents(t);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
  const { code, sessionKey } = await asHost.mutation(api.rooms.create, CREATE);
  const guest = await t.mutation(api.rooms.join, { code, name: "Tam" });

  await t.mutation(api.rooms.leave, { code, sessionKey: guest.sessionKey });

  const view = await asHost.query(api.rooms.get, { code, sessionKey });
  expect(view!.members.map((m) => m.name)).toEqual(["Bec"]);
});

test("leaving takes your swipes with you, so unanimity is judged on who is here", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
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
  registerComponents(t);
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
  registerComponents(t);
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
  registerComponents(t);
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
  registerComponents(t);
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
  registerComponents(t);
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
  registerComponents(t);
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
  registerComponents(t);
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

// --- what the room itself is allowed to claim ------------------------------

test("rooms.get says a seeded room is a demonstration room", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
  const { code, sessionKey } = await asHost.mutation(api.rooms.create, CREATE);

  // Exactly what `seed` writes. `openRooms` already labels these honestly; the
  // room's own screens could not, because `get` never projected the flag.
  await t.run(async (ctx) => {
    const room = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", code)).unique();
    await ctx.db.patch(room!._id, { demo: true });
  });

  const view = await asHost.query(api.rooms.get, { code, sessionKey });
  expect(view!.room.demo).toBe(true);
});

test("a room somebody actually opened is not labelled a demonstration", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
  const { code, sessionKey } = await asHost.mutation(api.rooms.create, CREATE);

  // The column is optional, so the honest projection of "never set" is false,
  // not undefined -- a screen must never have to guess.
  const view = await asHost.query(api.rooms.get, { code, sessionKey });
  expect(view!.room.demo).toBe(false);
});

// --- a voter can see, and change, their own vote ---------------------------

/** A matched room of `names.length` people with a two-stop plan on it. */
async function roomWithPlan(t: TestConvex<typeof schema>, names: string[]) {
  const asHost = t.withIdentity({ subject: "u1", name: names[0] });
  const { code, sessionKey } = await asHost.mutation(api.rooms.create, {
    ...CREATE,
    headcount: names.length,
    budgetPerHeadCents: 5000,
    hostName: names[0],
  });
  const keys = [sessionKey];
  for (const name of names.slice(1)) {
    keys.push((await t.mutation(api.rooms.join, { code, name })).sessionKey);
  }

  const roomId = await t.run(async (ctx) => {
    const room = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", code)).unique();
    await ctx.db.patch(room!._id, { status: "matched" });
    return room!._id;
  });
  const questId = await t.run((ctx) =>
    ctx.db.insert("quests", {
      roomId, rank: 0, source: "places", placeId: "p", title: "The Long Weekend",
      blurb: "", priceLabel: "$14", priceCents: 1400, distanceKm: 1, discountPct: 0,
      score: 1, scoreBreakdown: {},
    }),
  );
  // Through the lease, exactly as `plans.generate` does.
  const token = await t.mutation(internal.plans.markGenerating, { roomId });
  await t.mutation(internal.plans.writePlan, {
    roomId,
    questId,
    token: token as string,
    stops: [
      {
        id: "s1", slot: "main", name: "The Long Weekend", startAt: CREATE.whenAt,
        durationMin: 60, costPerHeadCents: 1400, note: "", source: "llm", locked: false,
      },
    ],
    shareMessage: "x",
  });
  return { code, keys };
}

const SWAP = {
  id: "s1", slot: "main" as const, name: "Nightjar", startAt: CREATE.whenAt,
  durationMin: 60, costPerHeadCents: 1600, note: "", source: "llm" as const, locked: false,
};

test("rooms.get reports which way you voted, not merely that you did", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  // Four people, so needed() is 3 and the proposal stays open through a no and
  // a change of mind -- the two states a boolean could not tell apart.
  const { code, keys } = await roomWithPlan(t, ["Bec", "Tam", "Sam", "Kim"]);
  const [bec, tam, sam] = keys;

  const { proposalId } = await t.mutation(api.proposals.open, {
    code, sessionKey: bec, stopId: "s1", replacement: SWAP, reason: "closer to the tram",
  });

  // The proposer's own opening yes.
  const asBec = await t.query(api.rooms.get, { code, sessionKey: bec });
  expect(asBec!.proposals[0].yourVote).toBe("yes");

  // Nobody else has voted.
  const before = await t.query(api.rooms.get, { code, sessionKey: tam });
  expect(before!.proposals[0].yourVote).toBeNull();

  await t.mutation(api.proposals.vote, { code, sessionKey: tam, proposalId, vote: "no" });
  const voted = await t.query(api.rooms.get, { code, sessionKey: tam });
  expect(voted!.proposals[0].yourVote).toBe("no");
  // A no is not a yes: the tally must not move.
  expect(voted!.proposals[0].yes).toBe(1);
  expect(voted!.proposals[0].needed).toBe(3);

  // Changing your mind is a patch, so it shows as one vote, now the other way.
  await t.mutation(api.proposals.vote, { code, sessionKey: tam, proposalId, vote: "yes" });
  const changed = await t.query(api.rooms.get, { code, sessionKey: tam });
  expect(changed!.proposals[0].yourVote).toBe("yes");
  expect(changed!.proposals[0].yes).toBe(2);

  // And one member's vote is never another's.
  const asSam = await t.query(api.rooms.get, { code, sessionKey: sam });
  expect(asSam!.proposals[0].yourVote).toBeNull();
});

// --- setRules: the host's two house rules

/** A room with a host and one guest, and both of their keys. */
async function roomWithGuest(t: TestConvex<typeof schema>) {
  const asUser = t.withIdentity({ subject: "u1", name: "Bec" });
  const { code, sessionKey } = await asUser.mutation(api.rooms.create, CREATE);
  const guest = await t.mutation(api.rooms.join, { code, name: "Tam" });
  return { code, host: sessionKey, guest: guest.sessionKey };
}

test("a room starts with no card timer and the permissive settle rule", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asUser = t.withIdentity({ subject: "u1", name: "Bec" });
  const { code, sessionKey } = await asUser.mutation(api.rooms.create, CREATE);

  const view = await asUser.query(api.rooms.get, { code, sessionKey });
  // Absent columns, projected as the values every screen can actually draw.
  expect(view!.room.swipeSeconds).toBe(0);
  expect(view!.room.finalizeRule).toBe("anyone");
  expect(view!.room.finalizeSeconds).toBe(0);
  expect(view!.room.lockRule).toBe("anyone");
  expect(view!.finalize).toMatchObject({ votes: 0, needed: 1, youVoted: false, deadlineAt: null });
});

test("the host sets a card timer and every phone in the room sees it", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { code, host, guest } = await roomWithGuest(t);
  await t.mutation(api.rooms.setRules, { code, sessionKey: host, swipeSeconds: 30 });

  // Read back through the GUEST's key: the timer binds the people it is not set
  // by, so it has to reach them.
  const view = await t.query(api.rooms.get, { code, sessionKey: guest });
  expect(view!.room.swipeSeconds).toBe(30);
});

test("a guest cannot set the rules, and nothing moves when they try", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { code, host, guest } = await roomWithGuest(t);
  await t.mutation(api.rooms.setRules, { code, sessionKey: host, swipeSeconds: 30 });

  await expectUserError(
    t.mutation(api.rooms.setRules, { code, sessionKey: guest, swipeSeconds: 120 }),
    "NOT_THE_HOST",
    /host/i,
  );
  const view = await t.query(api.rooms.get, { code, sessionKey: host });
  expect(view!.room.swipeSeconds).toBe(30);
});

test("a stranger is told they are a stranger, not who the host is", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { code } = await roomWithGuest(t);
  await expectUserError(
    t.mutation(api.rooms.setRules, { code, sessionKey: "k-nobody", swipeSeconds: 30 }),
    "NOT_A_MEMBER",
    /not a member/i,
  );
});

test("sending one rule leaves the other two exactly as they were", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { code, host } = await roomWithGuest(t);
  await t.mutation(api.rooms.setRules, {
    code,
    sessionKey: host,
    finalizeRule: "majority",
    finalizeSeconds: 300,
  });
  // The timer moves on its own. If `setRules` wrote the whole set every time,
  // this call would carry whatever this phone last rendered for the other two.
  await t.mutation(api.rooms.setRules, { code, sessionKey: host, swipeSeconds: 60 });

  const view = await t.query(api.rooms.get, { code, sessionKey: host });
  expect(view!.room).toMatchObject({
    swipeSeconds: 60,
    finalizeRule: "majority",
    finalizeSeconds: 300,
  });
});

test("the host can put locking to a vote, and every phone in the room sees it", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { code, host, guest } = await roomWithGuest(t);
  await t.mutation(api.rooms.setRules, { code, sessionKey: host, lockRule: "vote" });

  // Read back through the GUEST's key: this rule changes which control the
  // people who are not the host are shown, so it has to reach them.
  const view = await t.query(api.rooms.get, { code, sessionKey: guest });
  expect(view!.room.lockRule).toBe("vote");
});

test("the host can hand locking to themselves, and it reaches the room", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { code, host, guest } = await roomWithGuest(t);
  await t.mutation(api.rooms.setRules, { code, sessionKey: host, lockRule: "host" });

  // Read through the GUEST's key: this rule takes a control away from them, so
  // their screen is the one that most needs to know.
  const view = await t.query(api.rooms.get, { code, sessionKey: guest });
  expect(view!.room.lockRule).toBe("host");
});

test("a guest cannot put locking to a vote either", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { code, host, guest } = await roomWithGuest(t);
  await expectUserError(
    t.mutation(api.rooms.setRules, { code, sessionKey: guest, lockRule: "vote" }),
    "NOT_THE_HOST",
    /host/i,
  );
  const view = await t.query(api.rooms.get, { code, sessionKey: host });
  expect(view!.room.lockRule).toBe("anyone");
});

test("moving the lock rule leaves the finalize vote alone", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { code, host } = await roomWithGuest(t);
  await t.mutation(api.rooms.setRules, { code, sessionKey: host, finalizeRule: "all" });

  // A real vote on the table, not just the rule fields. Asserting only that
  // `finalizeRule` survived would pass against a `setRules` that cleared the
  // votes on every lock-rule change -- which is the regression this is named
  // for.
  const roomId = await t.run(async (ctx) => {
    const room = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", code)).unique();
    const member = await ctx.db
      .query("members")
      .withIndex("by_room", (q) => q.eq("roomId", room!._id))
      .first();
    await ctx.db.insert("finalizeVotes", {
      roomId: room!._id, memberId: member!._id, at: Date.now(),
    });
    await ctx.db.patch(room!._id, { finalizeStartedAt: Date.now() });
    return room!._id;
  });

  await t.mutation(api.rooms.setRules, { code, sessionKey: host, lockRule: "vote" });

  // Two independent rules. Clearing the booking votes because the LOCK rule
  // moved would throw away consent to a question nothing changed about.
  const votes = await t.run(async (ctx) =>
    ctx.db.query("finalizeVotes").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect(),
  );
  expect(votes).toHaveLength(1);
  const view = await t.query(api.rooms.get, { code, sessionKey: host });
  expect(view!.room).toMatchObject({ finalizeRule: "all", lockRule: "vote" });
});

test("changing who settles the night throws away the votes already cast", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { code, host } = await roomWithGuest(t);
  await t.mutation(api.rooms.setRules, { code, sessionKey: host, finalizeRule: "all" });

  // A vote under the old rule. Seeded directly: `bookings.confirm` needs a
  // matched room with a plan, and what is under test here is the clearing.
  const roomId = await t.run(async (ctx) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    const member = await ctx.db
      .query("members")
      .withIndex("by_room", (q) => q.eq("roomId", room!._id))
      .first();
    await ctx.db.insert("finalizeVotes", {
      roomId: room!._id,
      memberId: member!._id,
      at: Date.now(),
    });
    await ctx.db.patch(room!._id, { finalizeStartedAt: Date.now() });
    return room!._id;
  });

  await t.mutation(api.rooms.setRules, { code, sessionKey: host, finalizeRule: "majority" });

  const after = await t.run(async (ctx) => ({
    votes: await ctx.db
      .query("finalizeVotes")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .collect(),
    room: await ctx.db.get(roomId),
  }));
  // A yes to "everyone has to agree" is not a yes to "most of you do", so
  // moving the threshold cannot carry the tally with it.
  expect(after.votes).toHaveLength(0);
  expect(after.room!.finalizeStartedAt).toBeUndefined();
});

test("setting the same rule again leaves an open vote alone", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { code, host } = await roomWithGuest(t);
  await t.mutation(api.rooms.setRules, { code, sessionKey: host, finalizeRule: "all" });

  const roomId = await t.run(async (ctx) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    const member = await ctx.db
      .query("members")
      .withIndex("by_room", (q) => q.eq("roomId", room!._id))
      .first();
    await ctx.db.insert("finalizeVotes", { roomId: room!._id, memberId: member!._id, at: 1 });
    return room!._id;
  });

  // Only a rule that MOVED clears the tally. A host nudging the card timer, or
  // re-picking the value already set, must not quietly reset everybody's vote.
  await t.mutation(api.rooms.setRules, { code, sessionKey: host, finalizeRule: "all" });
  await t.mutation(api.rooms.setRules, { code, sessionKey: host, swipeSeconds: 15 });

  const votes = await t.run(async (ctx) =>
    ctx.db
      .query("finalizeVotes")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .collect(),
  );
  expect(votes).toHaveLength(1);
});

test("a booked night's rules are frozen with the rest of it", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { code, host } = await roomWithGuest(t);
  await t.run(async (ctx) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    await ctx.db.patch(room!._id, { status: "booked" });
  });

  await expectUserError(
    t.mutation(api.rooms.setRules, { code, sessionKey: host, swipeSeconds: 30 }),
    "ROOM_BOOKED",
    /booked/i,
  );
});
