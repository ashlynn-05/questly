import { v } from "convex/values";
import { action, internalMutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import schema from "./schema";
import { requireUserId, safeUserId } from "./lib/access";
import { throwUserError } from "./lib/errors";
import { GOAL_IDS, moodAffinity, tasteSentence, type QuizAnswers } from "./lib/quiz";

// The 1536-float vector never goes to the browser -- this validator is what
// makes that a type error, not just a habit, if a future edit forgets to strip it.
const publicProfileValidator = schema.doc("profiles").omit("tasteVector");

export const me = query({
  args: {},
  returns: v.union(v.null(), publicProfileValidator),
  handler: async (ctx) => {
    const userId = await safeUserId(ctx);
    if (!userId) return null;

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!profile) return null;

    // The 1536-float vector never goes to the browser.
    const { tasteVector: _vector, ...rest } = profile;
    return rest;
  },
});

/**
 * Internal: `userId` here is not a trust boundary crossing, because the only
 * caller is `saveQuiz` below, which has already derived it from the
 * authenticated identity. Nothing else may call this, and it must stay
 * internal so nothing else can.
 */
export const write = internalMutation({
  args: {
    userId: v.string(),
    displayName: v.string(),
    tasteVector: v.array(v.float64()),
    tasteSentence: v.string(),
    moodAffinity: v.record(v.string(), v.number()),
    goals: v.optional(v.array(v.string())),
  },
  returns: v.id("profiles"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return await ctx.db.insert("profiles", { ...args, createdAt: Date.now() });
  },
});

export const saveQuiz = action({
  args: {
    answers: v.record(v.string(), v.union(v.literal("more"), v.literal("less"))),
    goals: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    // displayName is never accepted as an argument: a client-supplied name is
    // trivially spoofable, and a roomful of members all claiming the same name
    // is exactly the confusion this field exists to prevent. It is derived
    // here, from the authenticated identity, or not at all.
    const userId = await requireUserId(ctx);
    const identity = await ctx.auth.getUserIdentity();
    const displayName = identity?.name?.trim() || identity?.email?.trim() || "Explorer";

    for (const goal of args.goals) {
      if (!GOAL_IDS.has(goal)) {
        throwUserError("INVALID_GOAL", `"${goal}" is not one of the goals on offer.`);
      }
    }

    const sentence = tasteSentence(args.answers as QuizAnswers, args.goals);

    const embedding: number[] = await ctx.runAction(internal.ai.embeddings.embedText, {
      text: sentence,
    });

    await ctx.runMutation(internal.profiles.write, {
      userId,
      displayName,
      tasteVector: embedding,
      tasteSentence: sentence,
      moodAffinity: moodAffinity(args.answers as QuizAnswers),
      goals: args.goals,
    });
    return null;
  },
});
