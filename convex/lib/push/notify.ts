import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { enqueueRoomPush } from "./queue";
import { pushEventValidator } from "../../validators";

/**
 * The five moments that happen on somebody else's phone, and what they say.
 *
 * WHY THIS FILE EXISTS. Every one of them is already decided at exactly one
 * place in the backend -- `rooms.join`, `lib/match.ts`, `plans.writePlan`,
 * `proposals.open`, `bookings.writeBooking` -- and each of those places has a
 * comment saying it is the only copy of its rule. Adding notification copy and
 * a scheduling call to five files would put five copies of "who gets told, and
 * how" beside them. So the call sites get one line each, and everything that
 * one line MEANS is here.
 */

export type PushEvent = typeof pushEventValidator.type;

/**
 * Who a subscription belongs to, in the one form the table stores.
 *
 * An account owns its subscriptions by Better Auth subject, so they follow the
 * person across every room and every device. A guest has no account and no
 * identity beyond the seat they hold, so their subscription is owned by the
 * seat -- prefixed, so a member id can never be read as a subject or the other
 * way round.
 *
 * Built here and nowhere else. Two call sites spelling this key slightly
 * differently is a subscription that is written under one name and read under
 * another, which fails as silence: no error, no notification, nothing to see.
 */
export function ownerKey(member: Doc<"members">): string {
  return member.userId ?? seatOwnerKey(member._id);
}

/**
 * The seat's own key, whether or not the person sitting in it has an account.
 *
 * `ownerKey` answers "where do this person's subscriptions live", and for a
 * signed-in member that is their account. This answers the narrower question
 * `detachMember` needs: what belongs to THIS SEAT and dies with it. A member
 * giving up a seat must lose the subscriptions filed under it and keep the ones
 * filed under their account -- leaving one room is not turning notifications
 * off everywhere.
 */
export function seatOwnerKey(memberId: Id<"members">): string {
  return `member:${memberId}`;
}

/**
 * How many devices one owner may be told on.
 *
 * Bounded because every read of an owner's subscriptions is on the delivery
 * path, and the house rule is that no read grows with a table. This is not a
 * limit anybody reaches by using the product normally -- it is a phone, a
 * laptop, maybe a tablet -- but the rows are only ever removed when a browser
 * says the endpoint is dead, so a person who reinstalls a lot accumulates them.
 */
export const MAX_DEVICES_PER_OWNER = 10;

/** Every device one owner is listening on, bounded. */
export async function devicesOf(ctx: QueryCtx, owner: string) {
  return await ctx.db
    .query("pushSubscriptions")
    .withIndex("by_owner", (q) => q.eq("owner", owner))
    .take(MAX_DEVICES_PER_OWNER);
}

/**
 * Every subscription filed under one owner, gone.
 *
 * Shared by the two paths that end an owner: `roster.detachMember` when a seat
 * is given up, and `account.deleteAccount` when a person leaves entirely. Both
 * are hard deletes even though the profile tombstone is soft and restorable for
 * fourteen days -- a person who has deleted their account must stop receiving
 * notifications at the tap, and re-subscribing after a restore is one tap.
 *
 * A helper and not a Convex function. Its callers already did their own
 * authorisation, and a public "delete this owner's subscriptions" endpoint is a
 * way to silence somebody.
 */
export async function dropOwner(ctx: MutationCtx, owner: string): Promise<void> {
  for (const row of await devicesOf(ctx, owner)) {
    await ctx.db.delete(row._id);
  }
}

/** What one notification puts on a lock screen, and where tapping it goes. */
export type Notification = { title: string; body: string; url: string };

/**
 * The copy, as a pure function of the event and the room.
 *
 * Pure, and separated from the sending, for the reason `src/lib/help.ts` gives
 * for holding its prose as data: the suite can then assert what these actually
 * say. A sentence typed inline into an action is a sentence no test can reach.
 *
 * NOTHING HERE NAMES A VENUE, A PERSON, OR A PRICE. That is a rule, not an
 * oversight, and it is the ticket's third constraint: a notification must not
 * leak room contents to someone who is not a member. A push payload is
 * decrypted by the browser and drawn on a LOCKED screen, in front of whoever is
 * holding the phone -- and the endpoint it went to may have outlived the
 * person's membership, since a subscription is per browser and a roster can
 * change under it. "Your room matched" is true, useful, and gives away nothing;
 * "You matched on Marion, $18 a head" is a room's contents on a stranger's
 * lock screen. The room code is the one identifier that appears, and it is the
 * four digits the group has been reading aloud to each other all evening.
 */
export function notificationFor(event: PushEvent, roomCode: string): Notification {
  const url = `/room/${roomCode}`;
  switch (event) {
    case "joined":
      return { title: "Someone joined", body: `Room ${roomCode} has another person in it.`, url };
    case "matched":
      // The payoff moment the whole product is built around, so it is the one
      // that gets an exclamation of any kind.
      return { title: "It's a match", body: `Room ${roomCode} agreed on somewhere.`, url };
    case "planReady":
      return { title: "Your plan is ready", body: `Room ${roomCode} has a night written up.`, url };
    case "proposalOpened":
      // Phrased as the ask it is: this is the only one of the five that needs
      // the reader to DO something, and it says so.
      return { title: "A change needs your vote", body: `Someone proposed a swap in room ${roomCode}.`, url };
    case "booked":
      return { title: "The night is booked", body: `Room ${roomCode} is settled.`, url };
  }
}

/**
 * Tell everyone in a room except the person who caused it.
 *
 * The actor is passed as a MEMBER, never as a user id, and never from a client
 * argument. Every call site already holds the member row its `sessionKey`
 * resolved to, so the exclusion is derived from the same capability that
 * authorised the action -- which is the only way it can be trusted. Passing a
 * user id would let a caller nominate somebody else as "the actor" and silence
 * their notification.
 *
 * `null` is a real value here and means a system event with no actor: the plan
 * finishing is nobody's doing, so everybody hears about it.
 *
 * QUEUED, NOT AWAITED. Sending is an HTTP round trip per device and this runs
 * inside the transaction that just declared a match or wrote a booking. Nothing
 * on any screen may wait for a push service to answer; the realtime update has
 * to land now. The enqueue is transactional -- if this mutation rolls back, the
 * notification was never queued -- and the sending happens in its own action
 * afterwards, so a push service being slow or down cannot slow or fail the
 * mutation. `lib/push/queue.ts` holds the pool and why it is one.
 */
export async function notifyRoom(
  ctx: MutationCtx,
  roomId: Id<"rooms">,
  event: PushEvent,
  actor: Doc<"members"> | null,
): Promise<void> {
  // The SEAT, not the account. A guest actor has no user id, and excluding by
  // user id would send them a notification about their own tap -- the one thing
  // the ticket's fourth criterion forbids. Every member has a seat, signed in
  // or not, so this exclusion holds for both kinds of person.
  await enqueueRoomPush(ctx, roomId, event, actor?._id ?? null);
}
