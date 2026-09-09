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

};
