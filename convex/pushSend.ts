"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import { internalAction } from "./_generated/server";
import { pushEventValidator } from "./validators";

/**
 * The one place a push notification actually leaves the deployment.
 *
 * `"use node"` because `web-push` is Node-only -- it reaches for `crypto`,
 * `https` and `url`, and implements RFC 8291 payload encryption and RFC 8292
 * VAPID signing, neither of which is a few lines of our own. The guidelines
 * forbid `"use node"` in a file that also exports queries or mutations, so this
 * file exports actions and nothing else, and every database read it needs comes
 * back through `ctx.runQuery` against `convex/push.ts`.
 *
 * `convex/ai/embeddings.ts` is the only other file in this backend with the
 * directive, and it is the shape this one follows.
 */

/**
 * The address on the VAPID claim, which is a contact and not a login.
 *
 * A push service is entitled to a way to reach whoever is sending it traffic,
 * and it must be a `mailto:` or an `https:` URL. It is not a secret, it
 * authenticates nothing, and no push service verifies it -- so it is a
 * constant here rather than a third environment variable to set and forget.
 */
const VAPID_CONTACT = "mailto:hello@questly.app";

type Delivery = {
  title: string;
  body: string;
  url: string;
  targets: { endpoint: string; p256dh: string; auth: string }[];
};

/**
 * Send one notification to every device on the list, and report the dead ones.
 *
 * WHY THE ENVIRONMENT CHECK IS FIRST, BEFORE THE IMPORT. Two reasons, and the
 * second is the one that would have cost a real API call.
 *
 * Without keys there is nothing this could do but fail, and a deployment with
 * no keys set is the normal state of this feature until somebody issues them --
 * so the honest behaviour is to do nothing quietly, not to log a failure per
 * event forever.
 *
 * And the test suite runs with no keys. Every backend test file builds the
 * whole `convex/` module graph through `import.meta.glob`, and any test that
 * drains scheduled functions -- `plans.test.ts`, `swipes.test.ts` and
 * `bookings.test.ts` all do -- will execute this action. `web-push` sends over
 * `https.request`, which the network guard in `tests/setup.ts` does NOT wrap:
 * that guard replaces `globalThis.fetch` and nothing else. So a send from a
 * test would go out on the wire silently and the suite would stay green, which
 * is precisely the failure that guard was written after. This early return is
 * what makes that impossible, and `push.test.ts` asserts it.
 *
 * The import is dynamic for the same reason it is second: a top-level
 * `import webpush from "web-push"` would be evaluated by all twenty backend
 * test files the moment they build the module graph, not just by the ones that
 * send. Inside the handler, after the guard, it is only ever loaded on a
 * deployment that is actually configured to send.
 */
async function send(ctx: ActionCtx, delivery: Delivery | null): Promise<null> {
  if (!delivery) return null;

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;

  const webpush = (await import("web-push")).default;
  webpush.setVapidDetails(VAPID_CONTACT, publicKey, privateKey);

  const payload = JSON.stringify({
    title: delivery.title,
    body: delivery.body,
    url: delivery.url,
  });

  /**
   * Endpoints the push service says are permanently gone.
   *
   * Only 404 and 410. A 429, a 500 or a timeout is the service having a bad
   * minute and the subscription is still good; deleting a row over one would
   * unsubscribe somebody who did nothing and never tell them.
   */
  const expired: string[] = [];

  // In parallel, and each failure caught on its own. One phone whose push
  // service is down must not cost the other three their notification, and
  // `allSettled` alone would not be enough -- the endpoint has to survive into
  // the handler to be reported, which is what the closure here is for.
  await Promise.all(
    delivery.targets.map(async (target) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: target.endpoint,
            keys: { p256dh: target.p256dh, auth: target.auth },
          },
          payload,
          // A notification about a live room is worth about an hour. Past that
          // the group has either converged or gone home, and a push service
          // waking a phone for a vote that closed at nine is worse than
          // silence.
          { TTL: 60 * 60 },
        );
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          expired.push(target.endpoint);
          return;
        }
        // Everything else is logged and swallowed. This action is scheduled
        // and nothing awaits it, so a throw would buy a retry nobody asked
        // for and a red log line either way.
        console.warn(`pushSend: ${String(status ?? "no status")} for one endpoint; leaving it in place.`);
      }
    }),
  );

  if (expired.length > 0) {
    await ctx.runMutation(internal.push.dropExpired, { endpoints: expired });
  }
  return null;
}

/** One room event, to every member except whoever caused it. */
export const deliver = internalAction({
  args: {
    roomId: v.id("rooms"),
    event: pushEventValidator,
    actorMemberId: v.union(v.id("members"), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const delivery = await ctx.runQuery(internal.push.delivery, args);
    return await send(ctx, delivery);
  },
});

/** The "send a test" button, to the caller's own devices only. */
export const deliverTest = internalAction({
  args: { owner: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const delivery = await ctx.runQuery(internal.push.testDelivery, args);
    return await send(ctx, delivery);
  },
});
