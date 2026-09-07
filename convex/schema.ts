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

// The `events` and `snippets` tables were Create-Next-App scaffolding and are
// gone, along with `convex/events.ts` and `convex/ai/store.ts`. Both were
// reachable from public, unauthenticated functions -- `events.remove` let any
// signed-in user delete any row, and the snippet actions spent OpenAI quota for
// anyone holding the deployment URL. Neither had a product feature underneath.
export default defineSchema({
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
    // Which build holds that claim. A stalled build whose claim was taken must
    // not be able to overwrite the deck that replaced it, so every write checks
    // that the room still holds ITS token, not merely that a claim exists.
    buildToken: v.optional(v.string()),
    // The same two fields for the plan build, and for the same reason: a killed
    // `plans.generate` never reaches its own error handler, so without a claim
    // that can go stale a matched room would show "Writing the plan..." forever
    // with nothing able to start a second one. See `plans.markGenerating`.
    //
    // `planStartedAt` is the claim and is CLEARED when the build ends, so a
    // retry is possible again. `planToken` identifies which build made the
    // claim and is NOT cleared: it stays as the record of who last wrote the
    // plan, so a zombie build revived after its claim was taken is still
    // refused rather than being let back in by an empty field.
    planStartedAt: v.optional(v.number()),
    planToken: v.optional(v.string()),
    // Seeded rooms exist so the matchmaking lobby is never empty. They are
    // labelled everywhere they are shown: a fabricated stranger presented as a
    // real one would breach the product's honesty constraints.
    demo: v.optional(v.boolean()),
  })
    .index("by_code", ["code"])
    .index("by_visibility_status", ["visibility", "status"])
    // `deck.recentDeck` looks for rooms whose deck was built inside the TTL.
    // Without this it is a full `rooms` scan on the critical path of every
    // build, so the whole product stops building decks the moment the table
    // outgrows a transaction's read limit. The field already existed; this
    // adds no shape, only an ordering.
    .index("by_deckBuiltAt", ["deckBuiltAt"]),

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
