import { v } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./_generated/server";
import { publicMutation, publicQuery } from "./lib/customFunctions";
import { MAX_ROOM_MEMBERS, requireMember, roomByCode } from "./lib/access";
import { devicesOf, MAX_DEVICES_PER_OWNER, notificationFor, ownerKey } from "./lib/push/notify";
import { enqueueTestPush } from "./lib/push/queue";
import { pushEventValidator } from "./validators";
import { reserveRateLimit } from "./lib/rateLimits";

/**
 * Web push: the subscriptions, and who a notification is allowed to reach.
 *
 * The sending itself is NOT here. `web-push` is a Node-only package, and the
 * generated guidelines forbid `"use node"` in a file that also exports queries
 * or mutations, so the action lives alone in `convex/pushSend.ts`. This file is
 * the V8 half: the mutations a browser calls, the key it needs to subscribe,
 * and the internal reads the action runs against the database it cannot touch
 * itself.
 *
 * EVERY PUBLIC FUNCTION HERE WORKS SIGNED IN OR AS A GUEST, because the product
 * does. A signed-in caller is identified by `ctx.userId`, which the server
 * derives and no argument can influence. A guest is identified by the room code
 * and `sessionKey` they already hold -- the same capability `rooms.get` and
 * every other guest path accepts, resolved through `requireMember` so an
 * invalid key is refused here exactly as it is everywhere else.
 *
 * What a caller can never do is name somebody else. There is no user id, member
 * id or endpoint-owner argument anywhere in this file that a client chooses.
 */

/**
 * The seat a guest is speaking from, when they are not signed in.
 *
 * Optional, and optional together: a signed-in caller passes neither and is
 * identified by their account. Validated as one pair rather than two loose
 * strings so "a code with no key" cannot quietly resolve to anything.
 */
const seatArgs = {
  code: v.optional(v.string()),
  sessionKey: v.optional(v.string()),
};

/**
 * Resolve the caller to the key their subscriptions are filed under, or null.
 *
 * Signed in wins. A person with an account gets subscriptions that follow them
 * between rooms and devices, even when they happen to have handed us a seat as
 * well -- filing an account holder's device under a seat would silently lose it
 * the moment they left that room.
 *
 * Null means there is nobody to file anything under: signed out, and holding no
 * valid seat. Every caller treats that as "push does not apply to you" rather
 * than as an error, because it is the ordinary state of a browser that has not
 * joined anything yet.
 */
async function callerOwner(
  ctx: QueryCtx & { userId: string | null },
  args: { code?: string; sessionKey?: string },
): Promise<string | null> {
  if (ctx.userId) return ctx.userId;
  if (!args.code || !args.sessionKey) return null;
  const room = await roomByCode(ctx, args.code);
  const member = await requireMember(ctx, room._id, args.sessionKey);
  return ownerKey(member);
}

/**
 * What the delivery action is told about one recipient.
 *
 * Projected rather than handed the whole document, the way `myRoomValidator`
 * does in `profiles.ts`: the action has no business knowing whose row this is,
 * only where to send and how to encrypt. `owner` is deliberately absent.
 */
const deliveryTargetValidator = v.object({
  endpoint: v.string(),
  p256dh: v.string(),
  auth: v.string(),
});

/** The whole of what `pushSend.deliver` needs to do its job. */
const deliveryValidator = v.union(
  v.null(),
  v.object({
    title: v.string(),
    body: v.string(),
    url: v.string(),
    targets: v.array(deliveryTargetValidator),
  }),
);

/**
 * The public half of the VAPID pair, or null when push is not configured.
 *
 * Served from the deployment env rather than baked into the bundle as a
 * `NEXT_PUBLIC_` variable, so both halves of one keypair live in one place and
 * are rotated together with `npx convex env set`. The private half never leaves
 * the deployment; this one is designed to be public -- it is the application
 * server key the browser hands to its push service.
 *
 * Null is the honest answer on a deployment with no keys set, and every screen
 * treats it as "push does not exist here" rather than as a failure. That is
 * what makes this feature safe to merge before the keys are issued.
 *
 * Read inside the handler, never at module scope: a module-scope read is
 * evaluated once when the isolate starts, which would make the answer depend on
 * whether the environment was configured before or after that moment.
 */
export const publicKey = publicQuery({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: async (): Promise<string | null> => {
    return process.env.VAPID_PUBLIC_KEY ?? null;
  },
});

/**
 * Remember this browser.
 *
 * UPSERT ON ENDPOINT, NOT INSERT. A browser hands back the same endpoint every
 * time it subscribes -- after a service worker update, after the permission is
 * toggled off and on, after a reinstall -- so an insert would give that one
 * phone two rows and every notification twice. Patching also re-homes an
 * endpoint whose owner changed, which is what happens when a guest signs in, or
 * when one person signs out of a shared device and another signs in: the row
 * follows the endpoint, because the endpoint is the browser and the browser is
 * what will receive it.
 */
export const subscribe = publicMutation({
  args: {
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    ...seatArgs,
  },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const owner = await callerOwner(ctx, args);
    // Signed out and holding no seat. Nothing to file this under, and nothing
    // worth throwing about -- the browser simply has no identity here yet.
    if (!owner) return false;

    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .unique();

    if (existing) {
      // The keys are re-sent because a re-subscription can rotate them; the
      // browser generates a fresh pair whenever it makes a genuinely new
      // subscription, and encrypting to a stale key produces a payload that
      // phone can never open.
      await ctx.db.patch(existing._id, {
        owner,
        p256dh: args.p256dh,
        auth: args.auth,
      });
      return true;
    }

    const mine = await devicesOf(ctx, owner);

    // At the ceiling, the oldest row goes rather than the new one being
    // refused. Somebody standing in front of a phone that just asked for
    // permission has said yes to THIS device, and telling them no because of
    // devices they may not own any more would be the wrong half to drop.
    if (mine.length >= MAX_DEVICES_PER_OWNER) {
      const oldest = [...mine].sort((a, b) => a.createdAt - b.createdAt)[0];
      await ctx.db.delete(oldest._id);
    }

    await ctx.db.insert("pushSubscriptions", {
      owner,
      endpoint: args.endpoint,
      p256dh: args.p256dh,
      auth: args.auth,
      createdAt: Date.now(),
    });
    return true;
  },
});

/**
 * Forget this browser.
 *
 * Keyed on the endpoint and checked against the caller's own owner key, so
 * unsubscribing is turning off YOUR device and never somebody else's: an
 * endpoint is a string a client supplies, and without the ownership check
 * anybody holding one could silence the person it belongs to.
 *
 * Silent when the row is already gone or is not the caller's. The browser's own
 * `unsubscribe()` and this call are two independent operations and either can
 * land first, so "there was nothing to delete" is the ordinary outcome of a
 * retry, not a failure worth a sentence.
 */
export const unsubscribe = publicMutation({
  args: { endpoint: v.string(), ...seatArgs },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const owner = await callerOwner(ctx, args);
    if (!owner) return null;
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .unique();
    if (existing && existing.owner === owner) {
      await ctx.db.delete(existing._id);
    }
    return null;
  },
});

/**
 * Does this caller have any device listening? What the settings toggle draws.
 *
 * A count and not the rows: a subscription's endpoint and keys are the material
 * a payload is encrypted with, and no screen needs them. Sending them to the
 * browser would be handing out the one thing that has to stay server-side for
 * "sending must be server-side" to mean anything.
 *
 * NULL AND ZERO ARE DIFFERENT ANSWERS, and the difference is the reason this
 * returns a union rather than a number. Zero is "we know who you are and you
 * have no devices" -- draw the toggle, off. Null is "there is nobody here to
 * file a subscription under": signed out, holding no seat. A screen that
 * collapsed the two would offer a control that cannot work, and the client has
 * no other way to ask -- identity is resolved on the server and only there.
 */
export const myDeviceCount = publicQuery({
  args: seatArgs,
  returns: v.union(v.null(), v.number()),
  handler: async (ctx, args): Promise<number | null> => {
    const owner = await callerOwner(ctx, args);
    if (!owner) return null;
    const mine = await devicesOf(ctx, owner);
    return mine.length;
  },
});

/**
 * Prove it works, on your own devices only.
 *
 * The recipient is whoever the SERVER resolved the caller to be, and there is
 * no argument that could name anybody else. That is the whole security design
 * of this endpoint: a "send a notification" mutation that accepted a target
 * would be a way to push arbitrary text to arbitrary people, which is exactly
 * what the ticket's second constraint forbids.
 *
 * Rate limited because it is a public endpoint whose whole job is to cause
 * outbound network traffic, and keyed on the resolved owner so a guest's taps
 * are counted against their seat rather than against everybody else's.
 * `reserveRateLimit` is called straight from the lib here rather than through a
 * wrapper in `convex/rateLimits.ts`: those wrappers exist so ACTIONS can reach
 * a mutation-only limiter through `runMutation`, and this is already a
 * mutation.
 */
export const sendTest = publicMutation({
  args: seatArgs,
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const owner = await callerOwner(ctx, args);
    if (!owner) return false;
    await reserveRateLimit(ctx, "pushTest", owner);
    await enqueueTestPush(ctx, owner);
    return true;
  },
});

/**
 * Everyone in a room who should hear about this, and what to say.
 *
 * MEMBERSHIP IS THE SOURCE OF THE RECIPIENT LIST, and it is read here, on the
 * server, from the room's own roster. Nothing in the chain from the call site
 * to the push service accepts a user id, a member id or an endpoint from a
 * browser. That is the ticket's second constraint, and this query is where it
 * is actually enforced.
 *
 * The actor is excluded by SEAT rather than by account, which is what makes the
 * "no notification to the person who caused it" rule hold for a guest as well:
 * a guest has no account to compare, but everybody in a room has a seat.
 *
 * Returns null when there is nothing to send, so the action has one condition
 * to check rather than three: no room, no recipients, or a roster where nobody
 * has ever subscribed all arrive here as the same "nothing to do".
 */
export const delivery = internalQuery({
  args: {
    roomId: v.id("rooms"),
    event: pushEventValidator,
    actorMemberId: v.union(v.id("members"), v.null()),
  },
  returns: deliveryValidator,
  handler: async (ctx, args) => {
    const room = await ctx.db.get(args.roomId);
    // A room deleted between the mutation and this read is not an error worth
    // throwing -- there is simply nobody to tell.
    if (!room) return null;

    const members = await ctx.db
      .query("members")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .take(MAX_ROOM_MEMBERS);

    // Deduplicated by endpoint. One person can hold a seat as a guest and later
    // sign in on the same browser, which leaves the endpoint owned by their
    // account while the seat still exists; without this they would receive the
    // same notification twice.
    const seen = new Set<string>();
    const targets = [];
    for (const member of members) {
      if (member._id === args.actorMemberId) continue;
      for (const row of await devicesOf(ctx, ownerKey(member))) {
        if (seen.has(row.endpoint)) continue;
        seen.add(row.endpoint);
        targets.push({ endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth });
      }
    }
    if (targets.length === 0) return null;

    return { ...notificationFor(args.event, room.code), targets };
  },
});

/** The same shape for the test send, whose recipient is one owner's devices. */
export const testDelivery = internalQuery({
  args: { owner: v.string() },
  returns: deliveryValidator,
  handler: async (ctx, args) => {
    const rows = await devicesOf(ctx, args.owner);
    if (rows.length === 0) return null;

    return {
      title: "Questly",
      body: "Notifications are on. This is what one looks like.",
      // Settings, because that is where an account holder tapped the button and
      // where the control to turn it off again is. A guest tapping it from a
      // room lands on a page that tells them plainly it is for accounts, which
      // is a true answer to "where do I change this" and better than a dead
      // link into a room the notification cannot name.
      url: "/settings#notifications",
      targets: rows.map((row) => ({ endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth })),
    };
  },
});

/**
 * Delete endpoints the push service says are gone.
 *
 * A 404 or a 410 from a push service is authoritative and permanent: that
 * browser will never receive anything again, because the subscription was
 * revoked, the site data was cleared, or the endpoint expired. Nothing else is
 * treated this way -- a 429, a 500 or a timeout is the push service having a
 * bad minute, and deleting a live subscription over one would silently
 * unsubscribe somebody who did nothing.
 *
 * This is the "cleaned up when the browser reports them expired" half of the
 * ticket's second acceptance criterion.
 */
export const dropExpired = internalMutation({
  args: { endpoints: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    for (const endpoint of args.endpoints) {
      const row = await ctx.db
        .query("pushSubscriptions")
        .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
        .unique();
      if (row) await ctx.db.delete(row._id);
    }
    return null;
  },
});
