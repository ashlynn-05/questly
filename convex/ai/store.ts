import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "../_generated/server";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const snippets = await ctx.db.query("snippets").order("desc").take(50);
    // Never ship 1536 floats to the browser.
    return snippets.map(({ _id, _creationTime, text }) => ({ _id, _creationTime, text }));
  },
});

export const save = internalMutation({
  args: { text: v.string(), embedding: v.array(v.float64()) },
  handler: async (ctx, args) => ctx.db.insert("snippets", args),
});

export const byIds = internalQuery({
  args: { ids: v.array(v.id("snippets")) },
  handler: async (ctx, { ids }) => {
    const docs = await Promise.all(ids.map((id) => ctx.db.get(id)));
    return docs
      .filter((doc): doc is NonNullable<typeof doc> => doc !== null)
      .map(({ _id, text }) => ({ _id, text }));
  },
});
