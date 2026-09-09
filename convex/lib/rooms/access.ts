import type { Id, Doc } from "../../_generated/dataModel";
import type { QueryCtx, MutationCtx, ActionCtx } from "../../_generated/server";
import { throwUserError } from "../errors";

type Ctx = QueryCtx | MutationCtx;
type AnyCtx = Ctx | ActionCtx;

/**
 * Identity is always derived here, never passed in as an argument.
 *
 * `subject` is the Better Auth user id (the convex() plugin puts it there), so
 * it is what rooms.hostUserId and profiles.userId store, and what
 * t.withIdentity({ subject }) drives in tests. There is exactly one issuer, so
 * subject is unambiguous -- do not swap this for tokenIdentifier.
 */
export async function safeUserId(ctx: AnyCtx): Promise<string | null> {
  const identity = await ctx.auth.getUserIdentity();
  return identity?.subject ?? null;
}

export async function requireUserId(ctx: AnyCtx): Promise<string> {
  const userId = await safeUserId(ctx);
  if (!userId) throwUserError("NOT_SIGNED_IN", "You need to be signed in to do that.");
  return userId;
}

/**
 * Signed in, AND not on the way out.
 *
 * `profiles.deletedAt` was honoured only by the queries a screen reads --
 * `profiles.me`, `account.deletionStatus` -- which made the tombstone a
 * client-side redirect wearing a backend's clothes. A deleted account calling
 * `rooms.create` straight past the UI could still open new rooms and be their
 * host, and then `account.purgeExpired` would erase the profile out from under
 * them fourteen days later, leaving live rooms hosted by nobody.
 *
 * Deliberately NOT applied to `rooms.join`. A deleted account taking a seat is
 * exactly a guest taking a seat, which the product already allows for people
 * with no account at all; refusing it would be stricter than the rule it is
 * enforcing. Hosting is the thing that outlives the account, so hosting is
 * what this guards.
 */
export async function requireLiveUserId(ctx: Ctx): Promise<string> {
  const userId = await requireUserId(ctx);

  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  // No profile is not a tombstone -- it is somebody who never finished the
  // quiz, and they may host.
  if (profile?.deletedAt !== undefined) {
    throwUserError(
      "ACCOUNT_DELETED",
      "This account is being deleted. Restore it first, and then you can start a quest.",
    );
  }
  return userId;
}

/**
 * Guests have no account, so they cannot be identified by auth. A sessionKey is
 * a capability: holding it authorises acting as that one member in that one
 * room, and nothing else. It is never an identity claim, and no function may
 * accept a memberId or userId for authorisation in its place.
 */
export async function findMember(
  ctx: Ctx,
  roomId: Id<"rooms">,
  sessionKey: string,
): Promise<Doc<"members"> | null> {
  return await ctx.db
    .query("members")
    .withIndex("by_room_session", (q) => q.eq("roomId", roomId).eq("sessionKey", sessionKey))
    .unique();
}

export async function requireMember(
  ctx: Ctx,
  roomId: Id<"rooms">,
  sessionKey: string,
): Promise<Doc<"members">> {
  const member = await findMember(ctx, roomId, sessionKey);
  if (!member) throwUserError("NOT_A_MEMBER", "You are not a member of this room.");
  return member;
}

export async function findRoomByCode(ctx: Ctx, code: string): Promise<Doc<"rooms"> | null> {
  return await ctx.db
    .query("rooms")
    .withIndex("by_code", (q) => q.eq("code", code))
    .unique();
}

export async function roomByCode(ctx: Ctx, code: string): Promise<Doc<"rooms">> {
  const room = await findRoomByCode(ctx, code);
  if (!room) throwUserError("ROOM_NOT_FOUND", `No room with code ${code}.`);
  return room;
}

/**
 * A booked night is frozen.
 *
 * Once `bookings.confirm` has run, the group is holding a reference to a
 * specific itinerary -- on a screenshot, in a group chat, in someone's head.
 * Every path that could change that itinerary afterwards is refused here:
 * the solo swap, the group proposal, the vote that would apply one, and the
 * lock toggle.
 *
 * Unlocking is refused too, and that is not an oversight. A lock is the record
 * of what the group agreed to; releasing one after the booking reopens the swap
 * path that this guard exists to close, just by another door.
 *
 * Call it AFTER `requireMember`, so a stranger is told they are a stranger
 * rather than being told about the state of a room they are not in.
 */
export function refuseIfBooked(room: Doc<"rooms">): void {
  if (room.status === "booked") {
    throwUserError(
      "ROOM_BOOKED",
      "This night is booked, so the plan is settled -- everyone is working from it now.",
    );
  }
}

/**
 * `.take(MAX_ROOM_MEMBERS)` rather than `.collect().length`, which the Convex
 * guidelines name explicitly as the way to accidentally scan an unbounded
 * table. The roster genuinely cannot exceed `MAX_ROOM_MEMBERS` -- `rooms.join`
 * enforces it -- so the two are the same number today. The `take` is what keeps
 * them the same number if that ceiling ever moves, on a helper called from
 * every `settleProposal`.
 */
export async function memberCount(ctx: Ctx, roomId: Id<"rooms">): Promise<number> {
  const members = await ctx.db
    .query("members")
    .withIndex("by_room", (q) => q.eq("roomId", roomId))
    .take(MAX_ROOM_MEMBERS);
  return members.length;
}

/** Strict majority of the current roster. */
export function needed(members: number): number {
  return Math.floor(members / 2) + 1;
}

/**
 * A hard ceiling on the roster.
 *
 * A match needs every member to swipe yes on the same card, and unanimity over
 * a dozen people is already vanishingly rare -- past this point a room does not
 * converge, it just stalls. It also bounds rooms.get, which reads every
 * member's swipes on every update: roster x deck is the size of that read.
 */
export const MAX_ROOM_MEMBERS = 12;

const ALPHABET = "abcdefghijkmnopqrstuvwxyz23456789"; // no l/1, no o/0

export function newSessionKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

/** Four digits: short enough to read aloud across a table. */
export function newRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (b) => String(b % 10)).join("");
}
