import { Workpool } from "@convex-dev/workpool";
import { components, internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import type { PushEvent } from "./notify";

/**
 * The queue every outbound notification goes through.
 *
 * WHY A POOL AND NOT `ctx.scheduler.runAfter(0, ...)`. Both defer the work off
 * the mutation, which is the part that matters -- nothing on a screen may wait
 * for a push service to answer. Only the pool bounds how much of it runs at
 * once. One room event fans out to a request per device, and the events arrive
 * in bursts by their nature: a match notifies everybody, and a room that just
 * matched is about to have a plan written and a booking made. Unbounded, that
 * is a burst of parallel actions each holding several open sockets.
 *
 * It is also what this backend already does with deferred work.
 * `lib/planQueue.ts` is the same shape against its own pool, and two mechanisms
 * for "do this after the transaction" is one more than anybody needs to know
 * about.
 *
 * `maxParallelism: 8` matches `planGeneration` for no better reason than that
 * nothing here suggests a different number, and one number is easier to reason
 * about than two.
 *
 * RETRIES ARE OFF, deliberately, and the same as `planGeneration`. Retrying is
 * decided per endpoint inside `pushSend`, where the endpoint is actually known:
 * a 404 or 410 deletes the subscription, and anything else is logged and left
 * alone. A pool-level retry would re-run the whole fan-out because one device
 * out of four was briefly unreachable, re-sending to the three that already
 * received it.
 */
const pushDelivery = new Workpool(components.pushDelivery, {
  maxParallelism: 8,
  retryActionsByDefault: false,
});

/** One room event, to every member's devices except the actor's. */
export function enqueueRoomPush(
  ctx: MutationCtx,
  roomId: Id<"rooms">,
  event: PushEvent,
  actorMemberId: Id<"members"> | null,
) {
  return pushDelivery.enqueueAction(
    ctx,
    internal.pushSend.deliver,
    { roomId, event, actorMemberId },
    { retry: false },
  );
}

/** The settings screen's "send a test", to one owner's own devices. */
export function enqueueTestPush(ctx: MutationCtx, owner: string) {
  return pushDelivery.enqueueAction(
    ctx,
    internal.pushSend.deliverTest,
    { owner },
    { retry: false },
  );
}
