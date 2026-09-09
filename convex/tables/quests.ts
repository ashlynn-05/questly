import { defineTable } from "convex/server";
import { v } from "convex/values";

export const questTables = {
  quests: defineTable({
    roomId: v.id("rooms"),
    rank: v.number(),
    source: v.union(v.literal("partner"), v.literal("places")),
    placeId: v.string(),
    title: v.string(),
    blurb: v.string(),
    priceLabel: v.string(),
    // `null` when Google gave this place no price signal at all. NOT zero and
    // not a default band: an unpriced venue is a fact we do not have, and
    // storing a number here is what put "$35" on a public park and then quoted
    // it at $35 a head in a booking. `priceLabel` says so on the card and
    // `lib/scoring.ts` scores it neutrally. A union rather than v.optional so
    // "unknown" is a value every reader has to handle, not a field they can
    // forget exists.
    priceCents: v.union(v.number(), v.null()),
    distanceKm: v.number(),
    discountPct: v.number(),
    // A partner venue's own hosted image.
    photoUrl: v.optional(v.string()),
    // A Google photo reference, rendered via /places/photo. Never a media URL:
    // that would carry our API key into a stored row, where rotating the key
    // would silently break every deck already built.
    photoName: v.optional(v.string()),
    mapsUri: v.optional(v.string()),
    websiteUri: v.optional(v.string()),
    score: v.number(),
    scoreBreakdown: v.record(v.string(), v.number()),
  })
    .index("by_room_rank", ["roomId", "rank"])
    .index("by_photoName", ["photoName"]),

  photoLeases: defineTable({
    key: v.string(),
    token: v.string(),
    expiresAt: v.number(),
  }).index("by_key", ["key"]),

  swipes: defineTable({
    roomId: v.id("rooms"),
    questId: v.id("quests"),
    memberId: v.id("members"),
    dir: v.union(v.literal("yes"), v.literal("no")),
  })
    .index("by_room_quest", ["roomId", "questId"])
    .index("by_room_member", ["roomId", "memberId"]),

};
