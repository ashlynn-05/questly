import { defineTable } from "convex/server";
import { v } from "convex/values";
import { storedMoodValidator } from "../validators";

export const roomTables = {
  rooms: defineTable({
    hostUserId: v.string(),
    mood: storedMoodValidator,
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
    /**
     * How many cards this member has answered. The number `rooms.get` used to
     * work out by collecting every swipe row in the room.
     *
     * DERIVED, NEVER INCREMENTED, and that distinction is the whole design.
     * `resolveMatch` in `lib/rooms/match.ts` is its ONLY writer: it already
     * holds the roster and every swipe row in memory, after the caller's own
     * write, so it recomputes each member's count from the rows and patches
     * only the ones that disagree. Nothing adds one to it. Do not "optimise"
     * that into a delta at the insert site -- a delta is a second copy of the
     * rule, and the first path that writes a swipe without adjusting it makes
     * this number a quiet lie.
     *
     * Because it is derived, it also self-heals: any row written outside the
     * normal path (a fixture, a repair mutation, a feature nobody has written
     * yet) is corrected by the next mutation in that room.
     *
     * THE PRECONDITION, stated exactly, because it is narrower than it looks.
     * Every mutation that touches a swipe runs `resolveMatch` -- the
     * never-deadlock rule makes that mandatory, not merely conventional -- but
     * `resolveMatch` returns early on a room that is missing, already
     * `matched` or `booked`, not `swiping`, or holding no quests, and the
     * reconcile sits after those. What actually keeps this number true is that
     * the only two writers of swipe rows today are `swipes.cast`, which runs
     * only on a `swiping` room with a deck, and `detachMember`, which deletes
     * a member's swipes and that member's row in the same transaction, so no
     * SURVIVING member's count can go stale even down an early-return path.
     * A future mutation that clears somebody's swipes while leaving them on
     * the roster -- an undo, a room reset -- would break that, and would need
     * to reconcile itself or run above those returns.
     *
     * WHY IT IS STORED AT ALL. `rooms.get` is the one subscription the product
     * runs on and it re-runs on every write in the room, roughly 1150 times
     * over a full twelve-person session. It read the whole `swipes` range each
     * time, 96 rows at the ceiling, to produce exactly two numbers:
     * `swipedByYou` and the per-member tallies behind `waitingOn`. Neither ever
     * looked at `dir` or `questId`.
     *
     * WHY IT LIVES ON THE MEMBER ROW rather than in a table of its own. The
     * schema guidance says to keep high-churn fields off shared documents, and
     * that is aimed at heartbeats -- writes with no natural ceiling. This has
     * one: a member can answer each card once, so it is written at most
     * DECK_SIZE times per seat, ever. The roster is already read in full by
     * every caller that wants these counts, so a separate table would ADD a
     * read per member to the query this exists to shrink.
     *
     * It needs no decrement. `detachMember` deletes a member's swipes and then
     * the member row itself, so the count leaves with the thing it counts.
     *
     * Optional because every row written before this column existed has no
     * count; `convex/migrations.ts` backfills them. The read in `rooms.get`
     * must not switch over until that backfill has run.
     */
    swipeCount: v.optional(v.number()),
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
