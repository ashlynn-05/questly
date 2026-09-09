import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import {
  generationFamilyValidator,
  generationKey,
  memberForRequest,
  providerNames,
  providerValidator,
  rateLimiter,
  reserveRateLimit,
  requestFamilyValidator,
  requestNames,
} from "./lib/rateLimits";
import { safeUserId } from "./lib/access";
import {
  isRateLimitedError,
  providerQuotaUnavailableError,
  throwUserError,
} from "./lib/errors";

const requestArgs = {
  roomId: v.id("rooms"),
  memberId: v.id("members"),
  family: requestFamilyValidator,
};

const requestCheckReturns = v.object({
  user: v.optional(v.boolean()),
  member: v.boolean(),
  room: v.boolean(),
});

const userRequestArgs = { family: requestFamilyValidator };

/** Read-only admission check. It never consumes tokens. */
export const checkRequest = internalQuery({
  args: requestArgs,
  returns: requestCheckReturns,
  handler: async (ctx, args) => {
    await memberForRequest(ctx, args.roomId, args.memberId);
    const names = requestNames(args.family);
    const userId = await safeUserId(ctx);
    if (userId) {
      return {
        user: (await rateLimiter.check(ctx, names.user, {
          key: `${userId}:${args.family}`,
        })).ok,
        member: true,
        room: true,
      };
    }
    return {
      member: (await rateLimiter.check(ctx, names.member, {
        key: `member:${args.roomId}:${args.memberId}:${args.family}`,
      })).ok,
      room: (await rateLimiter.check(ctx, names.room, {
        key: `room:${args.roomId}:${args.family}`,
      })).ok,
    };
  },
});

/** Consume request admission atomically with all applicable policies. */
export const reserveRequest = internalMutation({
  args: requestArgs,
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await memberForRequest(ctx, args.roomId, args.memberId);
    const names = requestNames(args.family);
    const userId = await safeUserId(ctx);
    if (userId) {
      await reserveRateLimit(ctx, names.user, `${userId}:${args.family}`);
    } else {
      await reserveRateLimit(
        ctx,
        names.member,
        `member:${args.roomId}:${args.memberId}:${args.family}`,
      );
      await reserveRateLimit(ctx, names.room, `room:${args.roomId}:${args.family}`);
    }
    return null;
  },
});

/** Consume signed-in search/suggestion admission for standalone actions. */
export const reserveUserRequest = internalMutation({
  args: userRequestArgs,
  returns: v.null(),
  handler: async (ctx, { family }): Promise<null> => {
    const userId = await safeUserId(ctx);
    if (!userId) throwUserError("NOT_SIGNED_IN", "You need to be signed in to do that.");
    const names = requestNames(family);
    await reserveRateLimit(ctx, names.user, `${userId}:${family}`);
    return null;
  },
});

/** Read-only generation admission check. */
export const checkGeneration = internalQuery({
  args: { roomId: v.id("rooms"), family: generationFamilyValidator },
  returns: v.boolean(),
  handler: async (ctx, { roomId, family }) => {
    if (!(await ctx.db.get(roomId))) return false;
    return (await rateLimiter.check(ctx, "generation", { key: generationKey(roomId, family) })).ok;
  },
});

/** Consume one generation admission for a room. */
export const reserveGeneration = internalMutation({
  args: { roomId: v.id("rooms"), family: generationFamilyValidator },
  returns: v.null(),
  handler: async (ctx, { roomId, family }): Promise<null> => {
    if (!(await ctx.db.get(roomId))) throwUserError("ROOM_NOT_FOUND", "That room is gone.");
    await reserveRateLimit(ctx, "generation", generationKey(roomId, family));
    return null;
  },
});

const providerCheckReturns = v.object({ minute: v.boolean(), day: v.boolean() });

/** Read-only provider admission check for the next provider batch. */
export const checkProvider = internalQuery({
  args: { provider: providerValidator },
  returns: providerCheckReturns,
  handler: async (ctx, { provider }) => {
    const names = providerNames(provider);
    return {
      minute: (await rateLimiter.check(ctx, names.minute)).ok,
      day: (await rateLimiter.check(ctx, names.day)).ok,
    };
  },
});

/** Reserve one physical provider attempt under both the minute and UTC-day caps. */
export const reserveProvider = internalMutation({
  args: { provider: providerValidator },
  returns: v.null(),
  handler: async (ctx, { provider }): Promise<null> => {
    const names = providerNames(provider);
    try {
      await reserveRateLimit(ctx, names.minute);
      await reserveRateLimit(ctx, names.day);
    } catch (error) {
      if (isRateLimitedError(error)) throw error;
      throw providerQuotaUnavailableError();
    }
    return null;
  },
});
