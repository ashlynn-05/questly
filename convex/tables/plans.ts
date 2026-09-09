import { defineTable } from "convex/server";
import { v } from "convex/values";
import { proposalKindValidator, stopValidator } from "../validators";

export const planTables = {
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
};
