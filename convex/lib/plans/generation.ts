import { internal } from "../../_generated/api";
import type { ActionCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { jsonCompletion } from "../openai";
import { normalizeMood } from "../deck/scoring";
import { isOverBudget } from "./stops";
import { buildPlanPrompt, fallbackPlan, parsePlanResponse, type PlanInput } from "./prompt";
import { isProviderReservationError, isRateLimitedError } from "../errors";

export type GeneratePlanArgs = {
  roomId: Id<"rooms">;
  questId: Id<"quests">;
};

export async function generatePlan(ctx: ActionCtx, args: GeneratePlanArgs): Promise<null> {

    // Sequential queued duplicates stop before taking a lease or charging any
    // provider quota. A second check after the lease closes the stale-claim
    // race where the first build lands between these two transactions.
    if (await ctx.runQuery(internal.plans.hasPlan, { roomId: args.roomId })) return null;

    // The lease first, before any work is done or any money is spent. Both ways
    // in -- `resolveMatch` scheduling the first build, and `plans.retry`
    // scheduling a replacement -- come through here, so this one call is what
    // stops two builds running over each other however they were started.
    const token = await ctx.runMutation(internal.plans.markGenerating, { roomId: args.roomId });
    if (token === null) {
      // A live build already holds the room. Not an error: the group is about
      // to get a plan from whoever holds it.
      console.warn(
        `plans.generate: room ${args.roomId} is already having its plan written; standing down.`,
      );
      return null;
    }

    try {
      if (await ctx.runQuery(internal.plans.hasPlan, { roomId: args.roomId })) {
        await ctx.runMutation(internal.plans.abandonPlan, { roomId: args.roomId, token });
        return null;
      }

      const { room, quest, headcount } = await ctx.runQuery(internal.plans.planContext, args);

      const input: PlanInput = {
        venueName: quest.title,
        headcount,
        budgetPerHeadCents: room.budgetPerHeadCents,
        // HONESTY -- the anchor stop is priced at what the matched card says the
        // venue costs, never at a share of what the group said they could spend.
        // `null` is a venue Google gave no price signal for, and it stays null
        // all the way to the stop rather than becoming a number nobody quoted.
        anchorPriceCents: quest.priceCents ?? null,
        startAt: room.whenAt,
        mood: normalizeMood(room.mood),
      };

      // Charge only the build that won the room lease. Queued duplicates and
      // continuations stand down before this point and consume nothing.
      try {
        await ctx.runMutation(internal.rateLimits.reserveGeneration, {
          roomId: args.roomId,
          family: "plan",
        });
      } catch (error) {
        if (!isRateLimitedError(error)) throw error;
        const fallback = fallbackPlan(input);
        await ctx.runMutation(internal.plans.writePlan, {
          roomId: args.roomId,
          questId: args.questId,
          token,
          stops: fallback.stops,
          shareMessage: fallback.shareMessage,
        });
        return null;
      }

      // Start from the usable night, then improve on it if the model cooperates.
      let result = fallbackPlan(input);

      try {
        const raw = await jsonCompletion(
          buildPlanPrompt(input),
          () => ctx.runMutation(internal.rateLimits.reserveProvider, { provider: "openai" }),
        );
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
        if (isProviderReservationError(error)) throw error;
        // Never leave a matched room without a plan because a third party was
        // slow -- but never fall back silently either, or the outage is invisible.
        console.warn("plans.generate: no model plan, using the canned night.", error);
      }

      await ctx.runMutation(internal.plans.writePlan, {
        roomId: args.roomId,
        questId: args.questId,
        token,
        stops: result.stops,
        shareMessage: result.shareMessage,
      });
    } catch (error) {
      // The room or the quest is gone, or the write itself failed. Hand the
      // claim back rather than making the group wait out STALE_PLAN_MS before
      // the host's retry button will do anything.
      await ctx.runMutation(internal.plans.abandonPlan, { roomId: args.roomId, token });
      throw error;
    }
    return null;
}
