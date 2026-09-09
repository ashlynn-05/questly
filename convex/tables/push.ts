import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * One row per browser that has agreed to be told things.
 *
 * WHO OWNS A SUBSCRIPTION, AND WHY IT IS ONE COLUMN. This product has two kinds
 * of person and always has: an account, and a guest holding a `sessionKey` for
 * one room (`members.userId` is optional for exactly that reason). Both need
 * notifications -- a guest in a room is the person most likely to miss the
 * moment, because they have no other surface to see it on.
 *
 * `owner` is therefore an opaque key, not an id: the Better Auth subject for an
 * account, and `member:<memberId>` for a guest seat. `ownerKey` in
 * `convex/lib/push/notify.ts` is the only place either form is built, so the two
 * namespaces cannot be confused, and one index serves both. The alternative --
 * two optional columns and two indexes read in parallel on every delivery --
 * buys nothing except a second way for a read to miss.
 *
 * The consequence worth knowing: a guest's subscription is per room and dies
 * with their seat, because the seat is the whole of their identity here.
 * `detachMember` deletes it. An account's outlives any one room.
 *
 * NO `enabled` COLUMN. The row existing is the fact. A browser can revoke a
 * subscription without telling us, so a second source of truth would drift.
 */
export const pushTables = {
  pushSubscriptions: defineTable({
    owner: v.string(),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    createdAt: v.number(),
  })
    .index("by_owner", ["owner"])
    // The endpoint is the browser, and it is what a re-subscription hands back
    // unchanged. Upserting on it is what stops one phone accumulating a row per
    // service-worker update and receiving everything five times.
    .index("by_endpoint", ["endpoint"]),
};
