/// <reference types="vite/client" />
import { registerComponents } from "./testHelpers";
import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { expect, test, vi } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { rateLimiter } from "../../convex/lib/rateLimits";
import { errorCode, userMessage } from "../../src/lib/errors";

const modules = import.meta.glob("../../convex/**/*.ts");
type T = TestConvex<typeof schema>;

async function seedRoom(t: T, memberCount = 1, storedUserId?: string) {
  return await t.run(async (ctx) => {
    const roomId = await ctx.db.insert("rooms", {
      hostUserId: "owner",
      mood: "grass",
      headcount: Math.max(memberCount, 1),
      budgetPerHeadCents: 0,
      whenAt: Date.now() + 60 * 60 * 1000,
      centreLat: -37.8,
      centreLng: 144.96,
      radiusKm: 5,
      visibility: "private",
      status: "swiping",
      code: "4242",
    });
    const memberIds: Array<Id<"members">> = [];
    for (let index = 0; index < memberCount; index++) {
      memberIds.push(
        await ctx.db.insert("members", {
          roomId,
          name: `Guest ${index}`,
          ...(storedUserId ? { userId: storedUserId } : {}),
          isHost: false,
          sessionKey: `guest-${index}`,
          joinedAt: index,
        }),
      );
    }
    return { roomId, memberIds };
  });
}

function requestArgs(roomId: Id<"rooms">, memberId: Id<"members">) {
  return { roomId, memberId, family: "search" as const };
}

async function expectRateLimited(promise: Promise<unknown>) {
  await expect(promise).rejects.toBeInstanceOf(ConvexError);
  await expect(promise).rejects.toMatchObject({
    data: {
      code: "RATE_LIMITED",
      kind: "RateLimited",
      retryAfter: expect.any(Number),
    },
  });
}

test("request checks are read-only and do not consume the last slots", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { roomId, memberIds } = await seedRoom(t);
  const args = requestArgs(roomId, memberIds[0]);

  const checks = await Promise.all(
    Array.from({ length: 20 }, () => t.query(internal.rateLimits.checkRequest, args)),
  );
  expect(checks.every((check) => check.member && check.room)).toBe(true);

  for (let count = 0; count < 10; count++) {
    await t.mutation(internal.rateLimits.reserveRequest, args);
  }

  expect(await t.query(internal.rateLimits.checkRequest, args)).toMatchObject({
    member: false,
    room: true,
  });
});

test("a signed-out capability uses guest limits even when its member has an account id", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { roomId, memberIds } = await seedRoom(t, 1, "stored-account");
  const args = requestArgs(roomId, memberIds[0]);

  for (let count = 0; count < 10; count++) {
    await t.mutation(internal.rateLimits.reserveRequest, args);
  }

  expect(await t.query(internal.rateLimits.checkRequest, args)).toMatchObject({
    member: false,
    room: true,
  });
});

test("standalone signed-in search admission is keyed by the auth subject", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const user = t.withIdentity({ subject: "standalone-user" });

  for (let count = 0; count < 20; count++) {
    await user.mutation(internal.rateLimits.reserveUserRequest, { family: "search" });
  }
  await expectRateLimited(
    user.mutation(internal.rateLimits.reserveUserRequest, { family: "search" }),
  );
});

test("rate-limit denial keeps the app error contract and retry time", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const user = t.withIdentity({ subject: "contract-user" });

  for (let count = 0; count < 20; count++) {
    await user.mutation(internal.rateLimits.reserveUserRequest, { family: "search" });
  }

  let thrown: unknown;
  try {
    await user.mutation(internal.rateLimits.reserveUserRequest, { family: "search" });
  } catch (error) {
    thrown = error;
  }

  expect(errorCode(thrown)).toBe("RATE_LIMITED");
  expect(userMessage(thrown, "fallback")).toMatch(/too many requests/i);
  expect(thrown).toMatchObject({
    data: {
      kind: "RateLimited",
      name: "userSearch",
      retryAfter: expect.any(Number),
    },
  });
  expect((thrown as ConvexError<{ retryAfter: number }>).data.retryAfter).toBeGreaterThan(0);
});

test("room search admission uses the current auth subject for signed-in callers", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { roomId, memberIds } = await seedRoom(t, 1, "stored-account");
  const user = t.withIdentity({ subject: "current-auth-subject" });
  const args = requestArgs(roomId, memberIds[0]);

  for (let count = 0; count < 20; count++) {
    await user.mutation(internal.rateLimits.reserveRequest, args);
  }

  await expectRateLimited(user.mutation(internal.rateLimits.reserveRequest, args));
  expect(await user.query(internal.rateLimits.checkRequest, args)).toMatchObject({
    user: false,
    member: true,
    room: true,
  });
});

test("concurrent request reservations admit exactly the member last slot", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { roomId, memberIds } = await seedRoom(t);
  const args = requestArgs(roomId, memberIds[0]);

  const attempts = await Promise.allSettled(
    Array.from({ length: 11 }, () => t.mutation(internal.rateLimits.reserveRequest, args)),
  );
  expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(10);
  const rejected = attempts.filter((attempt) => attempt.status === "rejected");
  expect(rejected).toHaveLength(1);
  await expectRateLimited(Promise.reject(rejected[0].reason));

  expect(await t.query(internal.rateLimits.checkRequest, args)).toMatchObject({
    member: false,
    room: true,
  });
});

test("a multi-policy denial rolls back the member reservation", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { roomId, memberIds } = await seedRoom(t, 5);
  const target = requestArgs(roomId, memberIds[0]);

  for (let count = 0; count < 9; count++) {
    await t.mutation(internal.rateLimits.reserveRequest, target);
  }
  for (const memberId of memberIds.slice(1, 4)) {
    for (let count = 0; count < 10; count++) {
      await t.mutation(internal.rateLimits.reserveRequest, requestArgs(roomId, memberId));
    }
  }
  await t.mutation(internal.rateLimits.reserveRequest, requestArgs(roomId, memberIds[4]));

  expect(await t.query(internal.rateLimits.checkRequest, target)).toMatchObject({
    member: true,
    room: false,
  });
  await expectRateLimited(t.mutation(internal.rateLimits.reserveRequest, target));
  expect(await t.query(internal.rateLimits.checkRequest, target)).toMatchObject({
    member: true,
    room: false,
  });
});

test("generation admission allows three reservations and rejects the fourth", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { roomId } = await seedRoom(t);

  expect(await t.query(internal.rateLimits.checkGeneration, { roomId, family: "plan" })).toBe(true);
  expect(await t.query(internal.rateLimits.checkGeneration, { roomId, family: "deck" })).toBe(true);
  for (let count = 0; count < 3; count++) {
    await t.mutation(internal.rateLimits.reserveGeneration, { roomId, family: "plan" });
  }
  expect(await t.query(internal.rateLimits.checkGeneration, { roomId, family: "plan" })).toBe(false);
  expect(await t.query(internal.rateLimits.checkGeneration, { roomId, family: "deck" })).toBe(true);
  await expectRateLimited(
    t.mutation(internal.rateLimits.reserveGeneration, { roomId, family: "plan" }),
  );
});

test("provider minute and UTC-day caps are atomic with no refund after day denial", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-09T12:00:00.000Z"));
  try {
    const t = convexTest(schema, modules);
    registerComponents(t);

    // Spend 30-minute slices across distinct minutes so the daily cap is the
    // only policy that can deny the final reservation.
    for (let minute = 0; minute < 6; minute++) {
      for (let count = 0; count < 30; count++) {
        await t.mutation(internal.rateLimits.reserveProvider, { provider: "openai" });
      }
      vi.advanceTimersByTime(60_000);
    }
    for (let count = 0; count < 20; count++) {
      await t.mutation(internal.rateLimits.reserveProvider, { provider: "openai" });
    }

    expect(await t.query(internal.rateLimits.checkProvider, { provider: "openai" })).toEqual({
      minute: true,
      day: false,
    });
    await expectRateLimited(
      t.mutation(internal.rateLimits.reserveProvider, { provider: "openai" }),
    );
    // The minute reservation was part of the same parent mutation and was
    // rolled back when the UTC-day policy denied; it remains available.
    expect(await t.query(internal.rateLimits.checkProvider, { provider: "openai" })).toEqual({
      minute: true,
      day: false,
    });

    vi.setSystemTime(new Date("2026-09-10T00:00:00.000Z"));
    expect(await t.query(internal.rateLimits.checkProvider, { provider: "openai" })).toEqual({
      minute: true,
      day: true,
    });
    await t.mutation(internal.rateLimits.reserveProvider, { provider: "openai" });
  } finally {
    vi.useRealTimers();
  }
});

test("provider component-store failures are fail-closed and preserve rate-limit errors", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const limit = vi.spyOn(rateLimiter, "limit").mockRejectedValue(new Error("component unavailable"));
  try {
    await expect(
      t.mutation(internal.rateLimits.reserveProvider, { provider: "google" }),
    ).rejects.toMatchObject({
      data: {
        code: "PROVIDER_QUOTA_UNAVAILABLE",
        message: expect.stringMatching(/temporarily unavailable/i),
      },
    });
  } finally {
    limit.mockRestore();
  }
});

test("concurrent provider reservations admit exactly the final minute slot", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);

  const attempts = await Promise.allSettled(
    Array.from({ length: 31 }, () =>
      t.mutation(internal.rateLimits.reserveProvider, { provider: "openai" }),
    ),
  );
  expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(30);
  expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
  await expectRateLimited(Promise.reject(attempts.find((attempt) => attempt.status === "rejected")!.reason));
  expect(await t.query(internal.rateLimits.checkProvider, { provider: "openai" })).toMatchObject({
    minute: false,
    day: true,
  });
});
