import { Workpool } from "@convex-dev/workpool";
import { components, internal } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

const planGeneration = new Workpool(components.planGeneration, {
  maxParallelism: 8,
  retryActionsByDefault: false,
});

export function enqueuePlanGeneration(
  ctx: MutationCtx,
  roomId: Id<"rooms">,
  questId: Id<"quests">,
) {
  return planGeneration.enqueueAction(
    ctx,
    internal.plans.generate,
    { roomId, questId },
    { retry: false },
  );
}
