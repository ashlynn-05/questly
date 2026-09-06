import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const moodValidator = v.union(
  v.literal("grass"),
  v.literal("meet"),
  v.literal("treat"),
  v.literal("new"),
);

export const slotValidator = v.union(
  v.literal("meet"),
  v.literal("main"),
  v.literal("after"),
);

export const stopValidator = v.object({
  id: v.string(),
  slot: slotValidator,
  placeId: v.optional(v.string()),
  name: v.string(),
  startAt: v.number(),
  durationMin: v.number(),
  costPerHeadCents: v.number(),
  note: v.string(),
  source: v.union(
    v.literal("llm"),
    v.literal("places"),
    v.literal("manual"),
    v.literal("partner"),
  ),
  locked: v.boolean(),
});

export default defineSchema({
  // Realtime smoke test: proves Convex subscriptions push to every open client.
  events: defineTable({
    title: v.string(),
    createdBy: v.string(),
    createdByName: v.string(),
    createdAt: v.number(),
  }).index("by_createdAt", ["createdAt"]),

  // --- AI layer (isolated) -------------------------------------------------
  // Delete this table together with convex/ai/ to remove the OpenAI dependency.
  snippets: defineTable({
    text: v.string(),
    embedding: v.array(v.float64()),
  }).vectorIndex("by_embedding", {
    vectorField: "embedding",
    dimensions: 1536, // text-embedding-3-small
  }),
  // -------------------------------------------------------------------------

  profiles: defineTable({
    userId: v.string(),
    displayName: v.string(),
    tasteVector: v.array(v.float64()),
    tasteSentence: v.string(),
    moodAffinity: v.record(v.string(), v.number()),
    // Optional: the table predates the goals question, and older rows never
    // wrote one. New writes always include it (as `[]` at minimum).
    goals: v.optional(v.array(v.string())),
    createdAt: v.number(),
  }).index("by_user", ["userId"]),

  // Hand-maintained partner inventory. Demonstration data, never a real deal.
  venues: defineTable({
    placeId: v.string(),
    name: v.string(),
    suburb: v.string(),
    lat: v.number(),
    lng: v.number(),
    photoUrl: v.optional(v.string()),
    priceFromCents: v.number(),
    discountPct: v.number(),
    offerText: v.string(),
    partnerTier: v.number(),
    moods: v.array(moodValidator),
    active: v.boolean(),
  })
    .index("by_placeId", ["placeId"])
    .index("by_active", ["active"]),

  rooms: defineTable({
    hostUserId: v.string(),
    mood: moodValidator,
    headcount: v.number(),
    budgetPerHeadCents: v.number(),
    whenAt: v.number(),
    centreLat: v.number(),
    centreLng: v.number(),
    radiusKm: v.number(),
    visibility: v.union(v.literal("private"), v.literal("open")),
    status: v.union(
      v.literal("lobby"),
      v.literal("building"),
      v.literal("swiping"),
      v.literal("matched"),
      v.literal("booked"),
    ),
    code: v.string(),
    matchedQuestId: v.optional(v.id("quests")),
    deckBuiltAt: v.optional(v.number()),
    // When the current build claimed the room. Set with status "building" in
    // one transaction, so a second build can tell a build in flight from one
    // whose action was killed before it could hand the room back.
    buildStartedAt: v.optional(v.number()),
    // Seeded rooms exist so the matchmaking lobby is never empty. They are
    // labelled everywhere they are shown: a fabricated stranger presented as a
    // real one would breach the product's honesty constraints.
    demo: v.optional(v.boolean()),
  })
    .index("by_code", ["code"])
    .index("by_visibility_status", ["visibility", "status"]),

  members: defineTable({
    roomId: v.id("rooms"),
    name: v.string(),
    userId: v.optional(v.string()),
    isHost: v.boolean(),
    sessionKey: v.string(),
    joinedAt: v.number(),
  })
    .index("by_room", ["roomId"])
    .index("by_room_session", ["roomId", "sessionKey"]),

  quests: defineTable({
    roomId: v.id("rooms"),
    rank: v.number(),
    source: v.union(v.literal("partner"), v.literal("places")),
    placeId: v.string(),
    title: v.string(),
    blurb: v.string(),
    priceLabel: v.string(),
    priceCents: v.number(),
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
  }).index("by_room_rank", ["roomId", "rank"]),

  swipes: defineTable({
    roomId: v.id("rooms"),
    questId: v.id("quests"),
    memberId: v.id("members"),
    dir: v.union(v.literal("yes"), v.literal("no")),
  })
    .index("by_room_quest", ["roomId", "questId"])
    .index("by_room_member", ["roomId", "memberId"]),

  plans: defineTable({
    roomId: v.id("rooms"),
    questId: v.id("quests"),
    stops: v.array(stopValidator),
    totalPerHeadCents: v.number(),
    shareMessage: v.string(),
  }).index("by_room", ["roomId"]),

  proposals: defineTable({
    roomId: v.id("rooms"),
    stopId: v.string(),
    proposedBy: v.id("members"),
    replacement: stopValidator,
    reason: v.string(),
    status: v.union(
      v.literal("open"),
      v.literal("accepted"),
      v.literal("rejected"),
    ),
  })
    .index("by_room_status", ["roomId", "status"])
    .index("by_room_stop", ["roomId", "stopId"]),

  proposalVotes: defineTable({
    proposalId: v.id("proposals"),
    memberId: v.id("members"),
    vote: v.union(v.literal("yes"), v.literal("no")),
  })
    .index("by_proposal", ["proposalId"])
    // A departing member takes their votes with them; finding them must not be
    // a full-table scan.
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
});
