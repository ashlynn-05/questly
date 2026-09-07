/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { expect, test } from "vitest";
import schema from "../schema";
import {
  requireMember, findMember, roomByCode, memberCount, needed, newRoomCode, newSessionKey,
  requireUserId, safeUserId,
} from "./access";

const modules = import.meta.glob("../**/*.ts");

// Schema-aware, so the seed below is checked against the real `rooms` and
// `members` shapes. A bare `ReturnType<typeof convexTest>` drops the schema
// type parameter and would accept any object at all.
async function seedRoom(t: TestConvex<typeof schema>) {
  return await t.run(async (ctx) => {
    const roomId = await ctx.db.insert("rooms", {
      hostUserId: "u1", mood: "grass", headcount: 2, budgetPerHeadCents: 0,
      whenAt: 1, centreLat: 0, centreLng: 0, radiusKm: 5,
      visibility: "private", status: "lobby", code: "1234",
    });
    await ctx.db.insert("members", {
      roomId, name: "Tam", isHost: true, sessionKey: "good-key", joinedAt: 1,
    });
    return roomId;
  });
}

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

test("requireMember accepts the right session key", async () => {
  const t = convexTest(schema, modules);
  const roomId = await seedRoom(t);
  const name = await t.run(async (ctx) => (await requireMember(ctx, roomId, "good-key")).name);
  expect(name).toBe("Tam");
});

test("requireMember rejects a wrong session key with NOT_A_MEMBER", async () => {
  const t = convexTest(schema, modules);
  const roomId = await seedRoom(t);
  await expectUserError(
    t.run(async (ctx) => requireMember(ctx, roomId, "guessed-key")),
    "NOT_A_MEMBER",
    /not a member/i,
  );
});

test("findMember returns null instead of throwing", async () => {
  const t = convexTest(schema, modules);
  const roomId = await seedRoom(t);
  expect(await t.run(async (ctx) => findMember(ctx, roomId, "guessed-key"))).toBeNull();
});

test("roomByCode finds the room and throws ROOM_NOT_FOUND for an unknown code", async () => {
  const t = convexTest(schema, modules);
  await seedRoom(t);
  expect(await t.run(async (ctx) => (await roomByCode(ctx, "1234")).code)).toBe("1234");
  await expectUserError(
    t.run(async (ctx) => roomByCode(ctx, "9999")),
    "ROOM_NOT_FOUND",
    /no room/i,
  );
});

test("memberCount counts the room roster", async () => {
  const t = convexTest(schema, modules);
  const roomId = await seedRoom(t);
  expect(await t.run(async (ctx) => memberCount(ctx, roomId))).toBe(1);
});

test("safeUserId returns null and requireUserId throws NOT_SIGNED_IN when signed out", async () => {
  const t = convexTest(schema, modules);
  expect(await t.run(async (ctx) => safeUserId(ctx))).toBeNull();
  await expectUserError(
    t.run(async (ctx) => requireUserId(ctx)),
    "NOT_SIGNED_IN",
    /signed in/i,
  );
});

test("safeUserId and requireUserId derive the subject from ctx.auth, never an argument", async () => {
  const t = convexTest(schema, modules).withIdentity({ subject: "u1" });
  expect(await t.run(async (ctx) => safeUserId(ctx))).toBe("u1");
  expect(await t.run(async (ctx) => requireUserId(ctx))).toBe("u1");
});

test("needed is a strict majority", () => {
  expect(needed(1)).toBe(1);
  expect(needed(2)).toBe(2);
  expect(needed(3)).toBe(2);
  expect(needed(4)).toBe(3);
  expect(needed(5)).toBe(3);
});

test("generated codes and keys are the right shape and not repeated", () => {
  expect(newRoomCode()).toMatch(/^\d{4}$/);
  expect(newSessionKey().length).toBeGreaterThanOrEqual(20);
  const keys = new Set(Array.from({ length: 200 }, () => newSessionKey()));
  expect(keys.size).toBe(200);
});
