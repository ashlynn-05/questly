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
  /**
   * The name of whoever locked this stop, cleared when it is unlocked.
   *
   * OPTIONAL, and it must stay optional: every plan document stored before this
   * field existed has no such key, and a required field would fail validation
   * for all of them.
   *
   * A name, not a member id. A lock is a social signal shown on a screen where
   * names are how people are identified, and a member who leaves takes their
   * row with them -- an id would go dangling and the lock would stop saying
   * who left it, which is the whole point of recording it.
   */
  lockedBy: v.optional(v.string()),
});

// The `events` and `snippets` tables were Create-Next-App scaffolding and are
// gone, along with `convex/events.ts` and `convex/ai/store.ts`. Both were
// reachable from public, unauthenticated functions -- `events.remove` let any
// signed-in user delete any row, and the snippet actions spent OpenAI quota for
// anyone holding the deployment URL. Neither had a product feature underneath.
/** One more-likely / less-likely card answer. */
export const answerValidator = v.union(v.literal("more"), v.literal("less"));

/** What a room is being asked to agree to. See the `proposals` table below. */
export const proposalKindValidator = v.union(
  v.literal("swap"),
  v.literal("lock"),
  v.literal("unlock"),
);

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
    /**
     * The raw card answers, kept so a person can be shown what they said.
     *
     * They used to be thrown away at the door: only the derived artefacts
     * survived (`tasteSentence`, `moodAffinity`, `tasteVector`), and not one of
     * them is invertible. `moodAffinity` sums the two cards that share a mood,
     * so a stored `0` means "one more, one less" and "neither answered" alike --
     * a settings screen reading it back would have to guess, and guessing at
     * somebody's own answers is worse than not showing them.
     *
     * Optional because every row written before this column existed has no
     * answers to show; `profiles.me` hands back `undefined` for those and the
     * screen says so rather than inventing a set.
     */
    answers: v.optional(v.record(v.string(), answerValidator)),
    /**
     * When this account was deleted, and the whole of the tombstone.
     *
     * Deletion is soft on purpose: the person has a window in which signing
     * back in restores them, and `account.purgeExpired` erases the row for good
     * once that window closes. So this field is a date, not a flag -- the date
     * IS the deadline. `profiles.me` returns null while it is set, so a deleted
     * account looks signed-out to the rest of the product without any other
     * screen having to know this column exists.
     */
    deletedAt: v.optional(v.number()),
    // The picture in this person's roundel, as a storage id and never a URL.
    // A stored URL would be a signed, expiring string baked into a row: it goes
    // stale on its own schedule and nothing here would know. `profiles.me`
    // resolves it through `ctx.storage.getUrl` on every read instead, which is
    // the only value that is true at the moment it is used.
    avatarId: v.optional(v.id("_storage")),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    // The purge job's read path. Without it, the daily cron is a full scan of
    // a table that grows with every account the product ever had.
    .index("by_deletedAt", ["deletedAt"]),

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
    /**
     * What the room is being asked to agree to.
     *
     * Optional because every proposal written before locking could be voted on
     * is a swap, and a migration to stamp a field that `?? "swap"` already
     * answers would be work for nothing. `settleProposal` reads it through that
     * default in the one place a proposal is applied; `proposals.open` writes
     * it explicitly, so no new row is ambiguous.
     */
    kind: v.optional(proposalKindValidator),
    /**
     * The stop that would take this one's place -- absent on a lock or unlock,
     * which changes nothing about what the stop IS.
     *
     * The alternative was to store the current stop here with `locked` flipped,
     * which would have kept this field required. It was rejected for being a
     * lie in the data: a row saying it replaces the Alderman with the Alderman
     * is one every future reader has to decode, and the screen would still need
     * `kind` to avoid offering "swap this for itself" as a vote.
     */
    replacement: v.optional(stopValidator),
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

  /**
   * One row per member who is in favour of booking the night as it stands.
   *
   * Yes only, and no `vote` column: retracting is deleting the row. A stop swap
   * is a choice between two things, so `proposalVotes` has to record WHICH way
   * you went; settling the night is a choice between doing it and not doing it
   * yet, and "not yet" is the absence of a yes. A no column here would be a
   * veto, which is a different product and not one the host was offered.
   */
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
});
