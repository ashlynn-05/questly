import { defineTable } from "convex/server";
import { v } from "convex/values";

export const bookingTables = {
  finalizeVotes: defineTable({
    roomId: v.id("rooms"),
    memberId: v.id("members"),
    at: v.number(),
  })
    .index("by_room", ["roomId"])
    .index("by_room_member", ["roomId", "memberId"])
    // A departing member takes their vote with them, exactly as they take their
    // proposal votes -- and finding it must not be a full-table scan.
    .index("by_member", ["memberId"]),

  bookings: defineTable({
    roomId: v.id("rooms"),
    questId: v.id("quests"),
    ref: v.string(),
    headcount: v.number(),
    totalCents: v.number(),
    status: v.literal("simulated"),
    deepLink: v.string(),
  }).index("by_room", ["roomId"]),
};
