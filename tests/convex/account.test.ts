/// <reference types="vite/client" />
import { registerComponents } from "./testHelpers";
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { PURGE_WINDOW_DAYS, PURGE_WINDOW_MS, daysLeft, purgeAt } from "../../convex/lib/account/window";

const modules = import.meta.glob("../../convex/**/*.ts");

/**
 * Every user-facing throw must arrive as a `ConvexError` carrying a stable
 * `code`, not just prose a copywriter could later change out from under a
 * regex. This asserts both. (Same helper, same reasoning, as `rooms.test.ts`.)
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

const PROFILE = {
  userId: "u1",
  displayName: "Bec",
  tasteVector: [0.1, 0.2],
  tasteSentence: "likes being outside",
  moodAffinity: { grass: 1 },
  goals: ["reset"],
};

// --- the window arithmetic ------------------------------------------------
//
// Pure, and the half of this feature that can be wrong quietly: an off-by-one
// on a boundary either purges a day early or leaves a row forever.

test("the purge falls exactly one window after the deletion", () => {
  expect(purgeAt(0)).toBe(PURGE_WINDOW_MS);
  expect(PURGE_WINDOW_MS).toBe(PURGE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
});

test("a fresh deletion has the whole window left", () => {
  const at = 1_800_000_000_000;
  expect(daysLeft(at, at)).toBe(PURGE_WINDOW_DAYS);
});

test("a part-used day still counts as a day left, never as none", () => {
  const at = 1_800_000_000_000;
  const halfADayBeforeTheEnd = purgeAt(at) - 12 * 60 * 60 * 1000;
  // Rounded up on purpose: flooring would show "0 days left" for the whole of
  // the final day, which reads as "already gone" to the one person still in a
  // position to stop it.
  expect(daysLeft(at, halfADayBeforeTheEnd)).toBe(1);
});

test("past the deadline the count floors at zero rather than going negative", () => {
  const at = 1_800_000_000_000;
  expect(daysLeft(at, purgeAt(at))).toBe(0);
  expect(daysLeft(at, purgeAt(at) + PURGE_WINDOW_MS)).toBe(0);
});

// --- who may delete -------------------------------------------------------

test("deleting requires an account, because there is nothing to delete without one", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  await expectUserError(
    t.mutation(api.account.deleteAccount, {}),
    "NOT_SIGNED_IN",
    /signed in/i,
  );
});

test("deletionStatus is null for a signed-out visitor", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  expect(await t.query(api.account.deletionStatus, {})).toBeNull();
});

test("deletionStatus is null for an account that has not asked to go", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asUser = t.withIdentity({ subject: "u1", name: "Bec" });
  await t.mutation(internal.profiles.write, PROFILE);
  expect(await asUser.query(api.account.deletionStatus, {})).toBeNull();
});

// --- the host refusal -----------------------------------------------------

test("deleting is refused while hosting a room that has not settled, and the refusal names it", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
  await t.mutation(internal.profiles.write, PROFILE);
  const { code } = await asHost.mutation(api.rooms.create, CREATE);

  await expectUserError(
    asHost.mutation(api.account.deleteAccount, {}),
    "HOSTING_LIVE_ROOM",
    new RegExp(code),
  );

  // And nothing happened: a refused delete must not half-run.
  expect(await asHost.query(api.account.deletionStatus, {})).toBeNull();
  const members = await t.run(async (ctx) => ctx.db.query("members").collect());
  expect(members).toHaveLength(1);
});

test("every live status blocks the delete while the night is still ahead", async () => {
  for (const status of ["lobby", "building", "swiping", "matched"] as const) {
    const t = convexTest(schema, modules);
  registerComponents(t);
    const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
    const { code } = await asHost.mutation(api.rooms.create, CREATE);
    await t.run(async (ctx) => {
      const room = await ctx.db
        .query("rooms")
        .withIndex("by_code", (q) => q.eq("code", code))
        .unique();
      await ctx.db.patch(room!._id, { status });
    });

    await expectUserError(
      asHost.mutation(api.account.deleteAccount, {}),
      "HOSTING_LIVE_ROOM",
      new RegExp(code),
    );
  }
});

test("a night that has already passed does not block the delete", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
  await t.mutation(internal.profiles.write, PROFILE);
  const { code } = await asHost.mutation(api.rooms.create, CREATE);
  await t.run(async (ctx) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    // Still `lobby` -- nobody ever started it -- but the date is behind us.
    await ctx.db.patch(room!._id, { whenAt: Date.now() - 86_400_000 });
  });

  // Nothing in this product can close a room: `rooms.leave` throws
  // HOST_CANNOT_LEAVE for the host and there is no cancel. Without the date
  // bound, this one forgotten room would refuse this account's deletion
  // forever, which is not a deletion.
  await asHost.mutation(api.account.deleteAccount, {});
  expect(await asHost.query(api.account.deletionStatus, {})).not.toBeNull();
});

test("the host seat in a dead room is given up like any other", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
  const { code } = await asHost.mutation(api.rooms.create, CREATE);
  await t.run(async (ctx) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    await ctx.db.patch(room!._id, { whenAt: Date.now() - 86_400_000 });
  });

  await asHost.mutation(api.account.deleteAccount, {});

  expect(await t.run(async (ctx) => ctx.db.query("members").collect())).toEqual([]);
});

test("the refusal names only actions the product actually has", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
  const { code } = await asHost.mutation(api.rooms.create, CREATE);

  // This assertion used to read the other way round: it forbade the word
  // "close", because closing a room was advice with nothing behind it. Now
  // `rooms.deleteRoom` exists, so the sentence may name it -- and the point of
  // the test is unchanged, which is why it now proves the advice is real rather
  // than trusting the wording. The host is alone in this room, which is exactly
  // the case `deleteRoom` allows.
  await expect(asHost.mutation(api.account.deleteAccount, {})).rejects.toMatchObject({
    data: { message: expect.stringContaining("close") },
  });

  // The action the sentence names, actually taken. If `deleteRoom` ever stops
  // covering this case the refusal is a dead end again, and this line fails
  // rather than the wording quietly drifting away from the product.
  await asHost.mutation(api.rooms.deleteRoom, { code });
  await asHost.mutation(api.account.deleteAccount, {});
});

test("holding a demo room's host seat blocks the delete, even though hostUserId is not you", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asUser = t.withIdentity({ subject: "u1", name: "Bec" });

  // `rooms.join` hands the host seat of an EMPTY demo room to whoever walks in
  // first, setting `isHost: true` while `hostUserId` keeps pointing at the
  // synthetic seed id. A guard that asked `rooms.by_host_status` saw no rooms
  // this account "hosted", so it would detach the only host row and leave a
  // roomful of people in a room that can never start -- walking around
  // HOST_CANNOT_LEAVE, which this refusal is the other half of.
  const { hostName: _hostName, ...ROOM } = CREATE;
  const code = await t.run(async (ctx) => {
    await ctx.db.insert("rooms", {
      ...ROOM,
      hostUserId: "questly-demo-host-9000",
      status: "lobby",
      code: "9000",
      demo: true,
    });
    return "9000";
  });

  await asUser.mutation(api.rooms.join, { code, name: "Bec" });
  const seat = await t.run(async (ctx) =>
    ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", "u1"))
      .unique(),
  );
  expect(seat!.isHost).toBe(true);

  await expectUserError(
    asUser.mutation(api.account.deleteAccount, {}),
    "HOSTING_LIVE_ROOM",
    /9000/,
  );
  expect(await t.run(async (ctx) => ctx.db.query("members").collect())).toHaveLength(1);
});

test("a booked room does not block the delete, because that night is already settled", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
  await t.mutation(internal.profiles.write, PROFILE);
  const { code } = await asHost.mutation(api.rooms.create, CREATE);
  await t.run(async (ctx) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    await ctx.db.patch(room!._id, { status: "booked" });
  });

  await asHost.mutation(api.account.deleteAccount, {});
  expect(await asHost.query(api.account.deletionStatus, {})).not.toBeNull();
});

// --- what deleting actually does -----------------------------------------

test("deleting tombstones the profile and hides it from the rest of the product", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asUser = t.withIdentity({ subject: "u1", name: "Bec" });
  await t.mutation(internal.profiles.write, PROFILE);

  await asUser.mutation(api.account.deleteAccount, {});

  // `profiles.me` is the query every other screen reads, and it must now say
  // there is nobody here -- that is what stops a deleted account being resumed
  // straight onto the mood step with its old taste vector.
  expect(await asUser.query(api.profiles.me, {})).toBeNull();

  const status = await asUser.query(api.account.deletionStatus, {});
  expect(status).not.toBeNull();
  expect(status!.purgeAt).toBe(purgeAt(status!.deletedAt));
});

test("the row survives the delete, because a restore with nothing to restore is not one", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asUser = t.withIdentity({ subject: "u1", name: "Bec" });
  await t.mutation(internal.profiles.write, PROFILE);

  await asUser.mutation(api.account.deleteAccount, {});

  const rows = await t.run(async (ctx) => ctx.db.query("profiles").collect());
  expect(rows).toHaveLength(1);
  expect(rows[0].tasteSentence).toBe("likes being outside");
  expect(rows[0].deletedAt).toEqual(expect.any(Number));
});

test("deleting gives up every seat, so no room is left waiting on somebody who has gone", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
  const asLeaver = t.withIdentity({ subject: "u2", name: "Tam" });
  await t.mutation(internal.profiles.write, { ...PROFILE, userId: "u2", displayName: "Tam" });

  const { code } = await asHost.mutation(api.rooms.create, CREATE);
  await asLeaver.mutation(api.rooms.join, { code, name: "Tam" });
  expect(await t.run(async (ctx) => ctx.db.query("members").collect())).toHaveLength(2);

  await asLeaver.mutation(api.account.deleteAccount, {});

  const members = await t.run(async (ctx) => ctx.db.query("members").collect());
  expect(members.map((m) => m.name)).toEqual(["Bec"]);
});

test("deleting takes the swipes and votes cast in those seats with it", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
  const asLeaver = t.withIdentity({ subject: "u2", name: "Tam" });

  const { code } = await asHost.mutation(api.rooms.create, CREATE);
  await asLeaver.mutation(api.rooms.join, { code, name: "Tam" });

  await t.run(async (ctx) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    const leaver = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", "u2"))
      .unique();
    const questId = await ctx.db.insert("quests", {
      roomId: room!._id, rank: 0, source: "places", placeId: "p", title: "T", blurb: "",
      priceLabel: "Free", priceCents: 0, distanceKm: 1, discountPct: 0, score: 1,
      scoreBreakdown: {},
    });
    await ctx.db.insert("swipes", {
      roomId: room!._id, questId, memberId: leaver!._id, dir: "yes",
    });
  });

  await asLeaver.mutation(api.account.deleteAccount, {});

  expect(await t.run(async (ctx) => ctx.db.query("swipes").collect())).toEqual([]);
});

test("a guest seat is untouched, because it belongs to a device and not to this account", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
  const asLeaver = t.withIdentity({ subject: "u2", name: "Tam" });

  const { code } = await asHost.mutation(api.rooms.create, CREATE);
  // No identity on this join: an accountless guest, recognised only by the
  // capability they were issued.
  await t.mutation(api.rooms.join, { code, name: "Sam" });
  await asLeaver.mutation(api.rooms.join, { code, name: "Tam" });

  await asLeaver.mutation(api.account.deleteAccount, {});

  const members = await t.run(async (ctx) => ctx.db.query("members").collect());
  expect(members.map((m) => m.name).sort()).toEqual(["Bec", "Sam"]);
});

test("somebody who never finished the quiz can still delete, and their seats still go", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
  const asLeaver = t.withIdentity({ subject: "u2", name: "Tam" });

  const { code } = await asHost.mutation(api.rooms.create, CREATE);
  await asLeaver.mutation(api.rooms.join, { code, name: "Tam" });

  // No `profiles.write` for u2 anywhere above: there is no profile to tombstone.
  await asLeaver.mutation(api.account.deleteAccount, {});

  const members = await t.run(async (ctx) => ctx.db.query("members").collect());
  expect(members.map((m) => m.name)).toEqual(["Bec"]);
  expect(await t.run(async (ctx) => ctx.db.query("profiles").collect())).toEqual([]);
});

// --- restoring ------------------------------------------------------------

test("restoring inside the window brings the account back as it was", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asUser = t.withIdentity({ subject: "u1", name: "Bec" });
  await t.mutation(internal.profiles.write, PROFILE);

  await asUser.mutation(api.account.deleteAccount, {});
  await asUser.mutation(api.account.restoreAccount, {});

  expect(await asUser.query(api.account.deletionStatus, {})).toBeNull();
  expect(await asUser.query(api.profiles.me, {})).toMatchObject({
    displayName: "Bec",
    tasteSentence: "likes being outside",
  });
});

test("restoring an account that was never deleted is refused rather than silently fine", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asUser = t.withIdentity({ subject: "u1", name: "Bec" });
  await t.mutation(internal.profiles.write, PROFILE);

  await expectUserError(
    asUser.mutation(api.account.restoreAccount, {}),
    "NOT_DELETED",
    /not scheduled/i,
  );
});

test("restoring is still allowed after the deadline, as long as the row is still there", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asUser = t.withIdentity({ subject: "u1", name: "Bec" });
  await t.mutation(internal.profiles.write, PROFILE);
  await asUser.mutation(api.account.deleteAccount, {});

  // The job runs daily, so there is a window of up to a day in which the
  // deadline has passed and the data is still present. Refusing in that gap
  // would tell somebody their account was gone while it was sitting right
  // there -- and then the next tick would make the lie true.
  await t.run(async (ctx) => {
    const row = await ctx.db.query("profiles").collect();
    await ctx.db.patch(row[0]._id, { deletedAt: Date.now() - PURGE_WINDOW_MS - 1 });
  });

  await asUser.mutation(api.account.restoreAccount, {});
  expect(await asUser.query(api.profiles.me, {})).not.toBeNull();
});

// --- the purge ------------------------------------------------------------

test("the purge leaves a live profile alone", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  await t.mutation(internal.profiles.write, PROFILE);

  // THE regression this test exists for. A document with no `deletedAt` is
  // still in the `by_deletedAt` index, and an absent value sorts BEFORE every
  // number -- so a one-sided `q.lt("deletedAt", cutoff)` matches every live
  // profile in the table, and the tidy-up job deletes the accounts of everyone
  // who never asked. The range is bounded at both ends for this reason alone.
  expect(await t.mutation(internal.account.purgeExpired, {})).toBe(0);
  expect(await t.run(async (ctx) => ctx.db.query("profiles").collect())).toHaveLength(1);
});

test("the purge leaves a deletion that is still inside its window alone", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asUser = t.withIdentity({ subject: "u1", name: "Bec" });
  await t.mutation(internal.profiles.write, PROFILE);
  await asUser.mutation(api.account.deleteAccount, {});

  expect(await t.mutation(internal.account.purgeExpired, {})).toBe(0);
  expect(await t.run(async (ctx) => ctx.db.query("profiles").collect())).toHaveLength(1);
});

test("the purge erases a deletion whose window has closed", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asUser = t.withIdentity({ subject: "u1", name: "Bec" });
  await t.mutation(internal.profiles.write, PROFILE);
  await asUser.mutation(api.account.deleteAccount, {});

  await t.run(async (ctx) => {
    const rows = await ctx.db.query("profiles").collect();
    await ctx.db.patch(rows[0]._id, { deletedAt: Date.now() - PURGE_WINDOW_MS - 1 });
  });

  expect(await t.mutation(internal.account.purgeExpired, {})).toBe(1);
  expect(await t.run(async (ctx) => ctx.db.query("profiles").collect())).toEqual([]);
});

test("the purge sorts the expired from the live in one pass", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  await t.mutation(internal.profiles.write, PROFILE);
  await t.mutation(internal.profiles.write, { ...PROFILE, userId: "u2", displayName: "Tam" });
  await t.mutation(internal.profiles.write, { ...PROFILE, userId: "u3", displayName: "Sam" });

  await t.run(async (ctx) => {
    const rows = await ctx.db.query("profiles").collect();
    const expired = rows.find((r) => r.userId === "u2")!;
    const recent = rows.find((r) => r.userId === "u3")!;
    await ctx.db.patch(expired._id, { deletedAt: Date.now() - PURGE_WINDOW_MS - 1 });
    await ctx.db.patch(recent._id, { deletedAt: Date.now() });
  });

  expect(await t.mutation(internal.account.purgeExpired, {})).toBe(1);
  const left = await t.run(async (ctx) => ctx.db.query("profiles").collect());
  expect(left.map((r) => r.userId).sort()).toEqual(["u1", "u3"]);
});

test("the purge drains a backlog in batches while live and restored rows survive", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asRestored = t.withIdentity({ subject: "u-restore", name: "Restored" });
  const now = Date.now();
  const expiredAt = now - PURGE_WINDOW_MS - 86_400_000;
  const restoreAt = now - PURGE_WINDOW_MS - 1;

  await t.run(async (ctx) => {
    for (let i = 0; i < 205; i++) {
      await ctx.db.insert("profiles", {
        ...PROFILE,
        userId: `u-expired-${i}`,
        displayName: `Expired ${i}`,
        deletedAt: expiredAt,
        createdAt: now,
      });
    }
    await ctx.db.insert("profiles", {
      ...PROFILE,
      userId: "u-live",
      displayName: "Live",
      createdAt: now,
    });
    await ctx.db.insert("profiles", {
      ...PROFILE,
      userId: "u-restore",
      displayName: "Restored",
      deletedAt: restoreAt,
      createdAt: now,
    });
  });

  expect(await t.mutation(internal.account.purgeExpired, {})).toBe(100);
  expect(await asRestored.query(api.account.deletionStatus, {})).not.toBeNull();

  // The row is expired, but the purge has not reached it yet. Restoring it
  // must remove it from the backlog before the next batch is taken.
  await asRestored.mutation(api.account.restoreAccount, {});

  expect(await t.mutation(internal.account.purgeExpired, {})).toBe(100);
  expect(await t.mutation(internal.account.purgeExpired, {})).toBe(5);
  expect(await t.mutation(internal.account.purgeExpired, {})).toBe(0);

  const left = await t.run(async (ctx) => ctx.db.query("profiles").collect());
  expect(left.map((row) => row.userId).sort()).toEqual(["u-live", "u-restore"]);
  expect(await asRestored.query(api.profiles.me, {})).toMatchObject({
    displayName: "Restored",
    tasteSentence: PROFILE.tasteSentence,
  });
});

test("the deadline is enforced by a job, not only by a comment", async () => {
  // A soft delete is a promise with a deadline on it, and nothing else in this
  // backend runs without a person triggering it. If `crons.ts` ever stops
  // registering a job, "erased after fourteen days" quietly becomes false and
  // every other test in this file still passes.
  const crons = (await import("../../convex/crons")).default;
  expect(Object.keys(crons.crons)).toHaveLength(1);
});

// --- the tombstone is a backend rule, not a redirect ----------------------

test("a deleted account cannot start a new room", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asUser = t.withIdentity({ subject: "u1", name: "Bec" });
  await t.mutation(internal.profiles.write, PROFILE);
  await asUser.mutation(api.account.deleteAccount, {});

  // `deletedAt` used to be honoured only by the queries a screen reads, which
  // made the tombstone a client-side redirect wearing a backend's clothes.
  // Calling straight past the UI, a deleted account could open rooms and be
  // their host -- and then `purgeExpired` would erase the profile out from
  // under them, leaving live rooms hosted by nobody.
  await expectUserError(
    asUser.mutation(api.rooms.create, CREATE),
    "ACCOUNT_DELETED",
    /being deleted/i,
  );
});

test("restoring gives the room back", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asUser = t.withIdentity({ subject: "u1", name: "Bec" });
  await t.mutation(internal.profiles.write, PROFILE);
  await asUser.mutation(api.account.deleteAccount, {});
  await asUser.mutation(api.account.restoreAccount, {});

  const { code } = await asUser.mutation(api.rooms.create, CREATE);
  expect(code).toMatch(/^\d{4}$/);
});

test("somebody who never finished the quiz may still host", async () => {
  // No profile is not a tombstone -- it is a guest who signed up and has not
  // answered the cards. Refusing them would break the funnel's own order.
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asUser = t.withIdentity({ subject: "u1", name: "Bec" });
  const { code } = await asUser.mutation(api.rooms.create, CREATE);
  expect(code).toMatch(/^\d{4}$/);
});
