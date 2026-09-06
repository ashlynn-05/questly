import { ConvexError } from "convex/values";

/**
 * Stable, machine-readable codes for every user-facing, user-actionable
 * failure in the backend.
 *
 * A plain `Error`'s message is redacted to "Server Error" on production
 * Convex deployments. `ConvexError`'s `.data` is delivered to the client
 * verbatim, so every throw the user can actually act on must go through
 * `throwUserError` below instead of `throw new Error(...)`.
 *
 * The client branches on `code`, which must never change once shipped.
 * `message` is the human-readable sentence already written at the call
 * site -- copy changes happen there, not here.
 */
export type ErrorCode =
  | "NOT_SIGNED_IN"
  | "NOT_A_MEMBER"
  | "ROOM_NOT_FOUND"
  | "ROOM_CLOSED"
  | "ROOM_FULL"
  | "FIELD_REQUIRED"
  | "HOST_CANNOT_LEAVE"
  | "NO_FREE_ROOM_CODE"
  | "NOT_THE_HOST"
  | "ROOM_WRONG_STATE"
  | "NO_CANDIDATES"
  | "BUILD_IN_PROGRESS"
  | "INVALID_GOAL";

export function throwUserError(code: ErrorCode, message: string): never {
  throw new ConvexError({ code, message });
}
