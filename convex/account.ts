import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { authenticatedMutation, publicQuery } from "./lib/customFunctions";
import { PURGE_WINDOW_MS, purgeAt } from "./lib/account/window";
import { throwUserError } from "./lib/errors";
import { dropOwner } from "./lib/push/notify";
import { detachMember } from "./lib/rooms/roster";

/**
 * Deleting an account, and the fourteen days in which it can be undeleted.
 *
 * The shape, and why it is this shape rather than one `ctx.db.delete`:
 *
 *  - The tombstone (`profiles.deletedAt`) is set immediately and
 *    `profiles.me` starts returning null, so the product behaves as though the
 *    account is gone from the first render after the tap.
 *  - The seats go immediately and for good, because they are not this person's
 *    data alone: a room waits on every member it has, and one that keeps
 *    waiting on somebody who has left is the deadlock the whole roster module
 *    exists to prevent.
 *  - The row itself survives the window, because a restore with nothing to
 *    restore is not a restore. `purgeExpired` erases it once the window closes.
 *
 * The cost of that third point is stated plainly on the screen rather than
 * buried here: for fourteen days the taste vector still exists. A delete that
 * erased everything at the tap and a delete that can be undone are different
 * products, and this branch was asked for the second.
 */

/** How the product asks whether this account is on its way out. */
const deletionStatusValidator = v.union(
  v.null(),
  v.object({ deletedAt: v.number(), purgeAt: v.number() }),
);

/**
 * The one function that admits a tombstoned profile is still there.
 *
 * Separate from `profiles.me` on purpose: `me` returns null for a deleted
 * account so no other screen has to know this state exists, which means `me`
 * cannot also be the thing that reports it. A signed-out caller and a caller
 * with no tombstone both get null -- neither is on their way out, and the
 * difference between them is not this query's business.
 */
export const deletionStatus = publicQuery({
  args: {},
  returns: deletionStatusValidator,
  handler: async (ctx) => {
    const userId = ctx.userId;
    if (!userId) return null;

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!profile || profile.deletedAt === undefined) return null;

    return { deletedAt: profile.deletedAt, purgeAt: purgeAt(profile.deletedAt) };
  },
});

/**
 * The statuses in which a host seat cannot be given up.
 *
 * A `booked` room is settled -- the group is holding a reference to an
 * itinerary and nothing left in the room can change it -- so its host leaving
 * costs nobody the night, and the branch already ruled that leaving a booked
 * room is allowed (`src/lib/booking.ts`). Every other status is a room
 * mid-flight: `deck.build` is host-only, so a `lobby` or `building` room whose
 * host has gone can never start, and a `swiping` or `matched` room still needs
 * that seat in the roster unanimity is judged against.
 */
const SETTLED_STATUS = "booked";

/**
 * Enough room codes to make the refusal actionable without turning it into a
 * list. Somebody hosting more live rooms than this has a bigger problem than
 * the wording.
 */
const MAX_NAMED_ROOMS = 3;

/**
 * And the refusal only ever covers a night that has not happened yet.
 *
 * Without this the refusal is a trap rather than a guard. `rooms.leave` throws
 * HOST_CANNOT_LEAVE for the host and there is no cancel, so a `lobby` room
 * nobody ever started stays `lobby` for good. `rooms.deleteRoom` now closes one
 * -- but only a room its host is alone in, because closing one with people
 * still in it deletes their night too. So "refuse while hosting an unsettled
 * room" on its own still means one abandoned room with a guest in it -- a
 * mistyped date, a plan that fell through -- permanently prevents that person
 * from deleting their account.
 *
 * A night in the past is not a night anyone can still lose, which is what the
 * refusal exists to protect. So the seat is given up and the dead room is left
 * empty, and the longest anybody can be held is until the date they themselves
 * chose. That is the trade: a stalled room costs a handful of people one
 * evening they can no longer attend anyway; a delete that can be refused
 * forever is not a delete.
 */

export const deleteAccount = authenticatedMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    const userId = ctx.userId;

    // Every seat this account holds, read ONCE and used for both halves of
    // this mutation -- the refusal below and the detach after it.
    //
    // Collected rather than `.take()`-bounded, which is the one place in this
    // file that departs from the house rule. The rule guards against reads that
    // grow with a TABLE; this range is one account's own seats on a dedicated
    // index, and a bound here would not be a safety margin -- it would be a
    // silent partial deletion, leaving somebody counted in a room they have
    // just left the product to get out of. Completeness is the requirement.
    const seats = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    // Host authority is `members.isHost`, NOT `rooms.hostUserId`.
    //
    // This guard used to ask `rooms.by_host_status` and it was wrong, because
    // the two can disagree: `rooms.join` hands the host seat of an EMPTY DEMO
    // room to whoever walks in first (`claimsHostSeat`, `convex/rooms.ts`),
    // setting `isHost: true` while `hostUserId` keeps pointing at the synthetic
    // seed id. So somebody could take a demo room's host seat, let a group
    // gather in it, and then delete their account: the old guard saw no rooms
    // they "hosted", detached the only host row, and left a roomful of people
    // in a room that can never start -- also walking straight around
    // `HOST_CANNOT_LEAVE`, which is the rule this refusal is the other half of.
    //
    // Asking the seats instead makes the guard agree with every other host
    // check in the product (`deck.ts`, `plans.ts`, `rooms.ts` all read
    // `isHost`), and it is bounded by the rows already in hand.
    const now = Date.now();
    const blocking: string[] = [];
    for (const seat of seats) {
      if (!seat.isHost) continue;
      const room = await ctx.db.get(seat.roomId);
      // A seat whose room is gone blocks nothing.
      if (!room) continue;
      if (room.status === SETTLED_STATUS) continue;
      if (room.whenAt <= now) continue;
      blocking.push(room.code);
    }

    if (blocking.length > 0) {
      const codes = blocking.slice(0, MAX_NAMED_ROOMS).join(", ");
      throwUserError(
        "HOSTING_LIVE_ROOM",
        // Only actions the product actually has. Closing a room is now one of
        // them (`rooms.deleteRoom`), but it refuses a room with somebody else
        // still in it, so booking the night and letting the date pass stay in
        // the sentence rather than being replaced by it.
        blocking.length === 1
          ? `You are still hosting room ${codes}, and that night has not happened yet. Book it, close it from your settings, or let the date pass, and then this will go through.`
          : `You are still hosting rooms ${codes}, and those nights have not happened yet. Book them, close them from your settings, or let the dates pass, and then this will go through.`,
      );
    }

    // Now they go -- swipes, proposal votes and the member row itself, with the
    // match and the open proposals re-decided against the smaller roster.
    // `detachMember` is the one implementation `rooms.leave` and
    // `rooms.removeMember` already share, and this is the third caller rather
    // than a fourth copy of the cleanup: the three paths must leave a room in
    // the same state or unanimity ends up judged differently depending on how
    // somebody left.
    //
    // Irreversible, and the only part of this mutation that is. `restoreAccount`
    // brings the profile back and cannot bring these back, so the screen says
    // so before the button is pressed rather than after.
    for (const seat of seats) {
      await detachMember(ctx, seat);
    }

    // Every browser this account was being notified on.
    //
    // A HARD delete, unlike the profile tombstone below it, and the difference
    // is deliberate: the tombstone is restorable for fourteen days because the
    // taste vector behind it took a quiz to build, and a push subscription
    // takes one tap. Somebody who has just deleted their account must stop
    // hearing from us at the tap, not a fortnight later if they never come
    // back. `restoreAccount` says so in its own words.
    //
    // Separate from the loop above, because `detachMember` drops what is filed
    // under a SEAT and these are filed under the ACCOUNT -- including devices
    // subscribed from the settings screen, which never belonged to any room.
    await dropOwner(ctx, userId);

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    // Somebody who never finished the quiz has no profile to tombstone. Their
    // seats are still detached above, which is the whole of what the product
    // holds on them, so this is a complete deletion and not a partial one.
    if (profile && profile.deletedAt === undefined) {
      await ctx.db.patch(profile._id, { deletedAt: Date.now() });
    }
    return null;
  },
});

/**
 * Change your mind, inside the window.
 *
 * Clearing the tombstone is the whole of it. The taste vector, the sentence,
 * and the answers were never touched, so the account comes back as it was
 * -- minus the seats and the push subscriptions, which are gone for good and
 * which the delete screen said would be.
 */
export const restoreAccount = authenticatedMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    const userId = ctx.userId;

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!profile || profile.deletedAt === undefined) {
      throwUserError("NOT_DELETED", "This account is not scheduled for deletion.");
    }

    // Deliberately NOT refused once the window has passed. A row that is still
    // here after `PURGE_WINDOW_DAYS` is a row the purge has not reached yet --
    // the job runs daily, so there is a gap of up to a day where the deadline
    // has passed and the data is still present. Refusing in that gap would tell
    // somebody their account was gone while it was sitting right there, and
    // then the next cron tick would make the lie true. If they came back, they
    // came back.
    await ctx.db.patch(profile._id, { deletedAt: undefined });
    return null;
  },
});

/**
 * Erase what the window was protecting. Runs daily, from `convex/crons.ts`.
 *
 * THE TRAP, and the reason this query is not the obvious one-sided range:
 * a document with no `deletedAt` is still in the `by_deletedAt` index, and an
 * absent value sorts BEFORE every number. So `q.lt("deletedAt", cutoff)` on its
 * own matches every live profile in the table, and the job that was meant to
 * tidy up after deletions would delete the accounts of everyone who never
 * asked. The range is bounded at both ends for that reason alone -- `gt(0)` is
 * not a plausible-timestamp check, it is the floor that excludes "absent".
 *
 * Bounded per run rather than collected: this is the one function in the
 * product with no user waiting on it, so there is no reason for it to be able
 * to grow into a transaction that cannot commit. A backlog is drained by
 * tomorrow's run.
 *
 * Returns how many rows it took, so the deployment's logs say whether it is
 * keeping up rather than only that it ran.
 */
const MAX_PURGE_PER_RUN = 100;

export const purgeExpired = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    const cutoff = Date.now() - PURGE_WINDOW_MS;

    const expired = await ctx.db
      .query("profiles")
      .withIndex("by_deletedAt", (q) => q.gt("deletedAt", 0).lt("deletedAt", cutoff))
      .take(MAX_PURGE_PER_RUN);

    for (const profile of expired) {
      await ctx.db.delete(profile._id);
    }
    return expired.length;
  },
});
