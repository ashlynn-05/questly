/// <reference types="vite/client" />
import { registerComponents } from "./testHelpers";

import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";

const modules = import.meta.glob("../../convex/**/*.ts");
type T = TestConvex<typeof schema>;

const FUTURE = Date.now() + 7 * 24 * 60 * 60 * 1000;

function identity(t: T, userId: string, name: string) {
  return t.withIdentity({ subject: userId, name });
}

test("100 users across 20 five-member rooms keep room state isolated under swipes", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const rooms: Array<{
    code: string;
    members: Array<{ userId: string; name: string; sessionKey: string }>;
  }> = [];

  for (let roomIndex = 0; roomIndex < 20; roomIndex++) {
    const firstUser = roomIndex * 5;
    const hostId = `load-user-${firstUser}`;
    const hostName = `User ${firstUser}`;
    const host = identity(t, hostId, hostName);
    const created = await host.mutation(api.rooms.create, {
      mood: "grass",
      headcount: 5,
      budgetPerHeadCents: 0,
      whenAt: FUTURE,
      centreLat: -37.8,
      centreLng: 144.96,
      radiusKm: 5,
      visibility: "private",
      hostName,
    });
    const members = [{ userId: hostId, name: hostName, sessionKey: created.sessionKey }];

    for (let offset = 1; offset < 5; offset++) {
      const userId = `load-user-${firstUser + offset}`;
      const name = `User ${firstUser + offset}`;
      const joined = await identity(t, userId, name).mutation(api.rooms.join, {
        code: created.code,
        name,
      });
      members.push({ userId, name, sessionKey: joined.sessionKey });
    }
    rooms.push({ code: created.code, members });
  }

  expect(new Set(rooms.flatMap((room) => room.members.map((member) => member.userId))).size).toBe(100);

  const quests = await t.run(async (ctx) => {
    const result: Array<{ code: string; questId: Id<"quests"> }> = [];
    for (const [roomIndex, roomState] of rooms.entries()) {
      const room = await ctx.db
        .query("rooms")
        .withIndex("by_code", (q) => q.eq("code", roomState.code))
        .unique();
      await ctx.db.patch(room!._id, { status: "swiping" });
      const questId = await ctx.db.insert("quests", {
        roomId: room!._id,
        rank: 0,
        source: "places",
        placeId: `load-place-${roomIndex}`,
        title: `Load place ${roomIndex}`,
        blurb: "",
        priceLabel: "Free",
        priceCents: 0,
        distanceKm: 1,
        discountPct: 0,
        score: 1,
        scoreBreakdown: {},
      });
      await ctx.db.insert("quests", {
        roomId: room!._id,
        rank: 1,
        source: "places",
        placeId: `load-place-${roomIndex}-second`,
        title: `Load place ${roomIndex} second`,
        blurb: "",
        priceLabel: "Free",
        priceCents: 0,
        distanceKm: 2,
        discountPct: 0,
        score: 0,
        scoreBreakdown: {},
      });
      result.push({ code: roomState.code, questId });
    }
    return result;
  });

  for (const { code, questId } of quests) {
    const room = rooms.find((candidate) => candidate.code === code)!;
    const outcomes = [];
    for (const member of room.members) {
      outcomes.push(
        await t.mutation(api.swipes.cast, { code, sessionKey: member.sessionKey, questId, dir: "no" }),
      );
    }
    expect(outcomes.every((outcome) => !outcome.matched)).toBe(true);
  }

  for (let roomIndex = 0; roomIndex < rooms.length; roomIndex++) {
    const room = rooms[roomIndex];
    const view = await t.query(api.rooms.get, {
      code: room.code,
      sessionKey: room.members[0].sessionKey,
    });
    expect(view).not.toBeNull();
    expect(view!.members).toHaveLength(5);
    expect(view!.room.status).toBe("swiping");
    expect(view!.progress.swipedByYou).toBe(1);
    for (const member of room.members) {
      expect(JSON.stringify(view)).not.toContain(member.sessionKey);
    }

    const foreign = rooms[(roomIndex + 1) % rooms.length];
    expect(await t.query(api.rooms.get, {
      code: foreign.code,
      sessionKey: room.members[0].sessionKey,
    })).toBeNull();
  }

  expect(await t.run(async (ctx) => ctx.db.query("members").collect())).toHaveLength(100);
  expect(await t.run(async (ctx) => ctx.db.query("swipes").collect())).toHaveLength(100);
});

test("a twelve-member room admits exactly its cap under join contention", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const hostId = "cap-host";
  const host = identity(t, hostId, "Cap Host");
  const { code, sessionKey: hostKey } = await host.mutation(api.rooms.create, {
    mood: "hangout",
    headcount: 12,
    budgetPerHeadCents: 0,
    whenAt: FUTURE,
    centreLat: -37.8,
    centreLng: 144.96,
    radiusKm: 5,
    visibility: "private",
    hostName: "Cap Host",
  });

  const attempts = await Promise.allSettled(
    Array.from({ length: 20 }, (_, index) => {
      const userId = `cap-user-${index}`;
      return identity(t, userId, `Cap User ${index}`).mutation(api.rooms.join, {
        code,
        name: `Cap User ${index}`,
      });
    }),
  );

  const accepted = attempts.filter((attempt) => attempt.status === "fulfilled");
  const rejected = attempts.filter((attempt) => attempt.status === "rejected");
  expect(accepted).toHaveLength(11);
  expect(rejected).toHaveLength(9);
  for (const attempt of rejected) {
    expect(attempt.reason).toBeInstanceOf(ConvexError);
    expect(attempt.reason).toMatchObject({ data: { code: "ROOM_FULL" } });
  }

  const view = await t.query(api.rooms.get, { code, sessionKey: hostKey });
  expect(view).not.toBeNull();
  expect(view!.members).toHaveLength(12);
  expect(new Set(view!.members.map((member) => member._id)).size).toBe(12);
});
