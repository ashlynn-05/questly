import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("events").withIndex("by_createdAt").order("desc").take(50);
  },
});

export const create = mutation({
  args: { title: v.string() },
  handler: async (ctx, { title }) => {
    const user = await authComponent.getAuthUser(ctx); // throws when signed out
    const trimmed = title.trim();
    if (!trimmed) throw new Error("Title is required");

    return await ctx.db.insert("events", {
      title: trimmed,
      createdBy: user._id,
      createdByName: user.name || user.email,
      createdAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("events") },
  handler: async (ctx, { id }) => {
    await authComponent.getAuthUser(ctx);
    await ctx.db.delete(id);
  },
});
