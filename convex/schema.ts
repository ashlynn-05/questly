import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

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
});
