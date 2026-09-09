import { DAY, MINUTE, RateLimiter, type RateLimitError } from "@convex-dev/rate-limiter";
import { ConvexError, v } from "convex/values";
import { components } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { throwUserError } from "./errors";

export const requestFamilyValidator = v.union(v.literal("search"), v.literal("suggest"));
export const generationFamilyValidator = v.union(v.literal("deck"), v.literal("plan"));
export const providerValidator = v.union(v.literal("google"), v.literal("openai"));

const limits = {
  userSearch: { kind: "token bucket", rate: 20, period: MINUTE, capacity: 20 },
  userSuggest: { kind: "token bucket", rate: 20, period: MINUTE, capacity: 20 },
  memberSearch: { kind: "token bucket", rate: 10, period: MINUTE, capacity: 10 },
  memberSuggest: { kind: "token bucket", rate: 10, period: MINUTE, capacity: 10 },
  roomSearch: { kind: "token bucket", rate: 40, period: MINUTE, capacity: 40 },
  roomSuggest: { kind: "token bucket", rate: 40, period: MINUTE, capacity: 40 },
  generation: { kind: "token bucket", rate: 3, period: 10 * MINUTE, capacity: 3 },
  googleMinute: { kind: "token bucket", rate: 120, period: MINUTE, capacity: 120 },
  googleDay: { kind: "fixed window", rate: 1000, period: DAY, capacity: 1000, start: 0 },
  openaiMinute: { kind: "token bucket", rate: 30, period: MINUTE, capacity: 30 },
  openaiDay: { kind: "fixed window", rate: 200, period: DAY, capacity: 200, start: 0 },
} as const;

export const rateLimiter = new RateLimiter(components.rateLimiter, limits);

function isOfficialRateLimitError(error: unknown): error is { data: RateLimitError } {
  if (!(error instanceof ConvexError)) return false;
  const data: unknown = error.data;
  if (typeof data !== "object" || data === null) return false;
  const record = data as Record<string, unknown>;
  return (
    record.kind === "RateLimited" &&
    typeof record.name === "string" &&
    typeof record.retryAfter === "number"
  );
}

export async function reserveRateLimit(
  ctx: MutationCtx,
  name: keyof typeof limits,
  key?: string,
): Promise<void> {
  try {
    await rateLimiter.limit(
      ctx,
      name,
      key === undefined ? { throws: true } : { key, throws: true },
    );
  } catch (error) {
    if (!isOfficialRateLimitError(error)) throw error;
    throw new ConvexError({
      code: "RATE_LIMITED",
      message: "Too many requests. Please try again later.",
      kind: "RateLimited",
      name: error.data.name,
      retryAfter: error.data.retryAfter,
    });
  }
}

export function requestNames(family: "search" | "suggest") {
  return {
    user: family === "search" ? "userSearch" : "userSuggest",
    member: family === "search" ? "memberSearch" : "memberSuggest",
    room: family === "search" ? "roomSearch" : "roomSuggest",
  } as const;
}

export function generationKey(roomId: Id<"rooms">, family: "deck" | "plan") {
  return `${roomId}:${family}`;
}

export async function memberForRequest(
  ctx: QueryCtx | MutationCtx,
  roomId: Id<"rooms">,
  memberId: Id<"members">,
) {
  const member = await ctx.db.get(memberId);
  if (!member || member.roomId !== roomId) {
    throwUserError("NOT_A_MEMBER", "You are not a member of this room.");
  }
  const room = await ctx.db.get(roomId);
  if (!room) throwUserError("ROOM_NOT_FOUND", "That room is gone.");
  return { member, room };
}

export function providerNames(provider: "google" | "openai") {
  return provider === "google"
    ? { minute: "googleMinute" as const, day: "googleDay" as const }
    : { minute: "openaiMinute" as const, day: "openaiDay" as const };
}
