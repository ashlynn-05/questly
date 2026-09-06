import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import schema, { stopValidator } from "./schema";
import { throwUserError } from "./lib/errors";
import { jsonCompletion } from "./lib/openai";
import { isOverBudget, totalPerHeadCents } from "./lib/stops";
import { buildPlanPrompt, fallbackPlan, parsePlanResponse, type PlanInput } from "./lib/planPrompt";

export const planContext = internalQuery({
  args: { roomId: v.id("rooms"), questId: v.id("quests") },
  returns: v.object({
    room: schema.doc("rooms"),
    quest: schema.doc("quests"),
    headcount: v.number(),
  }),
  handler: async (ctx, { roomId, questId }) => {
    const room = await ctx.db.get(roomId);
    const quest = await ctx.db.get(questId);
    if (!room) throwUserError("ROOM_NOT_FOUND", "That room is gone.");
    if (!quest) throwUserError("QUEST_NOT_FOUND", "That quest is gone.");

    const members = await ctx.db
      .query("members")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .collect();

    // The roster is the truth about who is actually coming; the room's stated
    // headcount is only the host's guess at lobby time. It stands in if the
    // roster somehow reads empty, so the prompt never asks for 0 people.
    return { room, quest, headcount: members.length || room.headcount };
  },
});

/**
 * Upsert, never insert.
 *
 * `generate` is scheduled, so a retry or a second match can put two of them on
 * this room. A second row would leave `rooms.get` -- the single subscription the
 * client runs on -- showing whichever plan `.first()` happens to land on, which
 * is the plan quietly reverting for everyone in the room.
 */
export const writePlan = internalMutation({
  args: {
    roomId: v.id("rooms"),
    questId: v.id("quests"),
    stops: v.array(stopValidator),
    shareMessage: v.string(),
  },
  returns: v.id("plans"),
  handler: async (ctx, args) => {
    // .first() rather than .unique(): rooms.get reads this row the same way, and
    // a duplicate must not turn into a throw on every write for that room.
    const existing = await ctx.db
      .query("plans")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .first();

    const doc = { ...args, totalPerHeadCents: totalPerHeadCents(args.stops) };
    if (existing) {
      await ctx.db.patch(existing._id, doc);
      return existing._id;
    }
    return await ctx.db.insert("plans", doc);
  },
});

/**
 * Turn the matched card into an actual night out.
 *
 * The canned plan is built first and the model only ever replaces it, so a
 * matched room always ends up with a plan: a missing key, a rate limit, a 5xx
 * or a model writing prose all land on the same usable night rather than on an
 * empty screen the group cannot get past.
 */
export const generate = internalAction({
  args: { roomId: v.id("rooms"), questId: v.id("quests") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const { room, quest, headcount } = await ctx.runQuery(internal.plans.planContext, args);

    const input: PlanInput = {
      venueName: quest.title,
      headcount,
      budgetPerHeadCents: room.budgetPerHeadCents,
      startAt: room.whenAt,
      mood: room.mood,
    };

    // Start from the usable night, then improve on it if the model cooperates.
    let result = fallbackPlan(input);

    try {
      const raw = await jsonCompletion(buildPlanPrompt(input));
      // `jsonCompletion` already parsed the body; re-serialising keeps every
      // untrusted model answer going through the one coercing, never-throwing
      // entry point rather than a second hand-rolled one here.
      const parsed = parsePlanResponse(JSON.stringify(raw), input);

      if (isOverBudget(parsed.stops, room.budgetPerHeadCents)) {
        // A $30 room being handed a $80 night -- or a free room being handed a
        // paid one -- is worse than the plainer plan we already have.
        console.warn("plans.generate: model plan was over budget; keeping the canned night.");
      } else {
        result = parsed;
      }
    } catch (error) {
      // Never leave a matched room without a plan because a third party was
      // slow -- but never fall back silently either, or the outage is invisible.
      console.warn("plans.generate: no model plan, using the canned night.", error);
    }

    await ctx.runMutation(internal.plans.writePlan, {
      roomId: args.roomId,
      questId: args.questId,
      stops: result.stops,
      shareMessage: result.shareMessage,
    });
    return null;
  },
});
