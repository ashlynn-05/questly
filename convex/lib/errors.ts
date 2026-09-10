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
  | "WHEN_IN_THE_PAST"
  | "NOT_THE_HOST"
  | "ROOM_WRONG_STATE"
  | "NO_CANDIDATES"
  | "BUILD_IN_PROGRESS"
  | "BUILD_SUPERSEDED"
  | "INVALID_GOAL"
  | "QUEST_NOT_FOUND"
  | "PLAN_NOT_READY"
  | "PLAN_IN_PROGRESS"
  | "PLACES_UNAVAILABLE"
  | "STOP_PRICE_INVALID"
  | "STOP_NOT_FOUND"
  | "STOP_LOCKED"
  | "GROUP_NEEDS_PROPOSAL"
  | "PROPOSAL_EXISTS"
  | "PROPOSAL_NOT_FOUND"
  | "NOTHING_TO_BOOK"
  | "ROOM_BOOKED"
  | "INVALID_ANSWER"
  | "NAME_REQUIRED"
  | "HOSTING_LIVE_ROOM"
  | "ROOM_HAS_COMPANY"
  | "DEMO_ROOM"
  | "NOT_DELETED"
  | "ACCOUNT_DELETED"
  | "AVATAR_MISSING"
  | "AVATAR_TYPE"
  | "AVATAR_SIZE"
  | "RATE_LIMITED"
  | "PROVIDER_QUOTA_UNAVAILABLE"
  | "DISCOVERY_LIMIT"
  | "VENUE_CATALOG_TOO_LARGE";

export function isRateLimitedError(
  error: unknown,
): error is ConvexError<{ code: "RATE_LIMITED"; message: string; retryAfter: number }> {
  if (!(error instanceof ConvexError)) return false;
  const data: unknown = error.data;
  if (typeof data !== "object" || data === null) return false;
  const record = data as Record<string, unknown>;
  return (
    record.code === "RATE_LIMITED" &&
    typeof record.message === "string" &&
    typeof record.retryAfter === "number"
  );
}

export function isProviderReservationError(error: unknown): boolean {
  if (isRateLimitedError(error)) return true;
  if (!(error instanceof ConvexError)) return false;
  const data: unknown = error.data;
  if (typeof data !== "object" || data === null) return false;
  return (data as Record<string, unknown>).code === "PROVIDER_QUOTA_UNAVAILABLE";
}

export function providerQuotaUnavailableError(): ConvexError<{
  code: "PROVIDER_QUOTA_UNAVAILABLE";
  message: string;
}> {
  return new ConvexError({
    code: "PROVIDER_QUOTA_UNAVAILABLE",
    message: "Provider quota is temporarily unavailable. Please try again later.",
  });
}

/** Preserve quota denials while classifying a failed internal action boundary. */
export async function runProviderReservation(reserve: () => Promise<unknown>): Promise<void> {
  try {
    await reserve();
  } catch (error) {
    if (isProviderReservationError(error)) throw error;
    throw providerQuotaUnavailableError();
  }
}

export function throwUserError(code: ErrorCode, message: string): never {
  throw new ConvexError({ code, message });
}
