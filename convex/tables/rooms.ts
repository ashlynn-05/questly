import { defineTable } from "convex/server";
import { v } from "convex/values";
import { moodValidator } from "../validators";

export const roomTables = {
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
    /**
     * The three house rules the host sets, and the one piece of state the
     * second of them needs. All optional, and all of them must stay optional:
     * every room opened before these existed has none of these keys.
     *
     * `swipeSeconds` is how long one card stays up before it passes itself.
     * Absent or 0 is no timer, which is what every existing room has and what a
     * new room starts with.
     *
     * A plain number rather than a union of the offered values, deliberately:
     * the allow-list belongs at the mutation boundary (`rooms.setRules`), where
     * refusing a bad value can produce a sentence. Putting it here as well
     * would mean retiring an option later breaks every room that chose it.
     */
    swipeSeconds: v.optional(v.number()),
    // Who has to say yes before the night is booked, and how long they get.
    // See `convex/lib/rules.ts` for the four values and why the default is the
    // permissive one.
    finalizeRule: v.optional(
      v.union(v.literal("anyone"), v.literal("host"), v.literal("majority"), v.literal("all")),
    ),
    finalizeSeconds: v.optional(v.number()),
    // When the open vote started, and the whole of the window. Cleared when the
    // vote passes, when it is retracted to nothing, when the roster moves, and
    // when the host changes the rule -- so its presence IS "a vote is open".
    finalizeStartedAt: v.optional(v.number()),
    // Whether putting a lock on a stop is a tap by anyone, a tap by the host,
    // or a vote. See `convex/lib/rules.ts` for the three values and why the
    // default is the permissive one.
    lockRule: v.optional(
      v.union(v.literal("anyone"), v.literal("host"), v.literal("vote")),
    ),
  })
    .index("by_code", ["code"])
    .index("by_visibility_status", ["visibility", "status"])
    .index("by_visibility_status_mood", ["visibility", "status", "mood"])
    // "The rooms you host", for the settings screen. `hostUserId` has been pure
    // provenance until now -- nothing authorises against it and nothing here
    // starts to -- but a host who lost their session key had no way back into
    // their own room short of remembering four digits, so the column is read as
    // well as written.
    .index("by_host", ["hostUserId"])
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
    .index("by_room_session", ["roomId", "sessionKey"])
    // Every seat one account holds, across rooms. Two readers, and neither can
    // afford to be a scan of a table that grows with every guest who ever
    // joined anything: "your rooms" on the settings screen, and the detach pass
    // in `account.deleteAccount`. Sparse by nature -- a guest row carries no
    // `userId`, and Convex does not index a field that is not there.
    .index("by_user", ["userId"]),

};
