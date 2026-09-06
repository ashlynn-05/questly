/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("a room can be written and read back by its code", async () => {
  const t = convexTest(schema, modules);
  const code = await t.run(async (ctx) => {
    const roomId = await ctx.db.insert("rooms", {
      hostUserId: "user_1",
      mood: "grass",
      headcount: 4,
      budgetPerHeadCents: 0,
      whenAt: 1_800_000_000_000,
      centreLat: -37.8,
      centreLng: 144.96,
      radiusKm: 5,
      visibility: "private",
      status: "lobby",
      code: "4471",
    });
    const room = await ctx.db.get(roomId);
    return room!.code;
  });
  expect(code).toBe("4471");
});

test("members can be listed by room", async () => {
  const t = convexTest(schema, modules);
  const names = await t.run(async (ctx) => {
    const roomId = await ctx.db.insert("rooms", {
      hostUserId: "user_1", mood: "grass", headcount: 2, budgetPerHeadCents: 0,
      whenAt: 1, centreLat: 0, centreLng: 0, radiusKm: 5,
      visibility: "private", status: "lobby", code: "0001",
    });
    await ctx.db.insert("members", {
      roomId, name: "Tam", isHost: false, sessionKey: "k1", joinedAt: 1,
    });
    const members = await ctx.db
      .query("members")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .collect();
    return members.map((m) => m.name);
  });
  expect(names).toEqual(["Tam"]);
});
