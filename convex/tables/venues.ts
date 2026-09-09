import { defineTable } from "convex/server";
import { v } from "convex/values";
import { moodValidator } from "../validators";

export const venueTables = {
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

  /**
   * One embedding per venue, shared by every room that is shown it.
   *
   * `lib/deck/build.ts` scores each candidate against the room's blended taste
   * vector, which needs a vector for the card. That is a fact about a VENUE,
   * not about a room, and the deck cache hands one room's finished cards
   * straight to the next -- so without this the borrowing room paid OpenAI to
   * re-derive vectors for venues that had just been embedded.
   *
   * KEYED ON THE VENUE, NOT ON THE TEXT, and that is the whole reason this
   * works. The two build paths do not describe the same place with the same
   * words: a full build embeds the Google summary, because `writeBlurbs` has
   * not run yet when the ranking happens, while a borrowing build embeds the
   * donor's finished LLM blurb off the stored quest row. Keyed on the string,
   * a borrow would miss on every places card -- exactly the case this exists
   * for -- and the table would grow by fifteen rows per build forever. Keyed
   * on the place, it hits, and the population really is bounded by how many
   * distinct venues exist in one city.
   *
   * ponytail: one vector per venue, whichever description reached it first.
   * A partner that rewrites its offer keeps the old vector until something
   * evicts it. Taste is one of six weighted terms and the offer text is the
   * commercial claim, which is read live off `venues` either way, so the cost
   * is a slightly stale ranking signal. Add a rewrite-triggered delete if
   * partners start changing copy often.
   *
   * `model` is part of the key rather than a column beside it. A model change
   * moves the vector width, `cosine` returns 0 on a width mismatch, and a deck
   * ranked on a mixture of real scores and hard zeros would systematically
   * demote every cached venue with nothing in the logs to say so. As part of
   * the key it is a clean miss instead.
   *
   * No TTL and no eviction: a row is roughly 6 KB of float and there is one
   * per venue per model. This is a plain table and not the action-cache
   * component because that one keys on a whole call's arguments, so caching a
   * batch of fifteen would only ever hit on the identical fifteen, and caching
   * one text at a time would turn a single batched request holding a single
   * quota reservation into fifteen of each.
   */
  venueEmbeddings: defineTable({
    model: v.string(),
    placeId: v.string(),
    vector: v.array(v.float64()),
  }).index("by_model_place", ["model", "placeId"]),

};
