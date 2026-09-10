import { Migrations } from "@convex-dev/migrations";
import { components } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { normalizeMood } from "./lib/deck/scoring";
import schema from "./schema";

/**
 * The backfills. There were none before this file, and that absence is written
 * all over the schema: nearly every column added after launch is
 * `v.optional(...)` forever, read through a `??` default, because stamping a
 * value onto rows that predate it meant hand-rolling a resumable table walk.
 *
 * That reasoning is correct for one column and does not scale to ten. This is
 * the tool those comments were working around.
 *
 * `internalMutation` is passed so migrations run as internal functions and
 * inherit the app's own table types; `schema` is passed so `customRange` can
 * name a real index. Neither is optional in practice.
 */
export const migrations = new Migrations(components.migrations, {
  internalMutation,
  schema,
});

/** `npx convex run migrations:run '{"fn": "migrations:backfillSwipeCount"}'` */
export const run = migrations.runner();

/**
 * Stamp `members.swipeCount` onto every seat that predates the column.
 *
 * WHY IT IS NEEDED AND WHEN TO RUN IT. `rooms.get` used to count a member's
 * swipe rows on every read. It now displays this number instead, and
 * `resolveMatch` is what writes it. A member row written before the column
 * existed has no number at all, so this must finish BEFORE the read switches
 * over. The ordering is three deploys' worth of care and one command:
 *
 *   1. deploy the column, the two initialisers and `resolveMatch`'s reconcile
 *      -- nothing reads the field yet, so nothing on screen can be wrong;
 *   2. run this;
 *   3. deploy the `rooms.get` change that reads it.
 *
 * Running it out of order is not dangerous, only pointless: step 1 must be live
 * or the field it writes has no writer keeping it true afterwards.
 *
 * IT IS SAFE TO RUN AGAINST A ROOM MID-GAME. This reads a member's swipes and
 * patches that member; a concurrent `swipes.cast` reads the same rows and
 * patches the same document. The read and write sets overlap, so Convex
 * serialises the two rather than letting one clobber the other.
 *
 * IT IS SAFE TO RUN TWICE. The count is recomputed from the rows every time,
 * not adjusted, so a second pass over an already-correct row writes nothing.
 * Recomputing unconditionally rather than skipping rows that already have a
 * number is deliberate: it makes this a repair tool as well as a backfill.
 */
export const backfillSwipeCount = migrations.define({
  table: "members",
  migrateOne: async (ctx, member) => {
    const swipes = await ctx.db
      .query("swipes")
      .withIndex("by_room_member", (q) =>
        q.eq("roomId", member.roomId).eq("memberId", member._id),
      )
      .collect();
    // Bounded by the deck, not by the table: a seat can answer each card once.
    // Returning undefined patches nothing, so an already-correct row costs a
    // read and no write.
    return member.swipeCount === swipes.length ? undefined : { swipeCount: swipes.length };
  },
});

/**
 * Rewrite every room whose activity is one of the four the product retired.
 *
 * `npx convex run migrations:run '{"fn": "migrations:backfillMoods"}'`
 *
 * WHY IT IS NEEDED. `meet` and `treat` described who you were with rather than
 * what you were doing, and that is now a separate question one screen later, so
 * the activity list is `grass`, `sidequest` and `hangout`. Every room written
 * before that carries one of the old ids.
 *
 * WHEN TO RUN IT. Any time after this branch is deployed, and the sooner the
 * better. The stored contract still accepts the retired ids -- see
 * `storedMoodValidator` -- precisely so this can be deployed and then run,
 * rather than needing to have already run. Until it does, `normalizeMood`
 * translates at every read, so nothing on screen is wrong in the meantime; what
 * is waiting on the backfill is the ability to DELETE that translation.
 *
 * IT IS SAFE TO RUN TWICE. The three current ids map to themselves, and a row
 * that already holds one is returned unpatched, so a second pass costs a read
 * and no write.
 *
 * IT IS SAFE TO RUN AGAINST A LIVE ROOM. The only field touched is `mood`, and
 * nothing in the product writes that field after `rooms.create`.
 */
export const backfillMoods = migrations.define({
  table: "rooms",
  migrateOne: (_ctx, room) => {
    const mood = normalizeMood(room.mood);
    return mood === room.mood ? undefined : { mood };
  },
});

/**
 * The same rewrite for the partner catalogue.
 *
 * `npx convex run migrations:run '{"fn": "migrations:backfillVenueMoods"}'`
 *
 * Separate from `backfillMoods` because it is a separate table and the runner
 * takes one -- not because either depends on the other. Run both.
 *
 * A venue tagged `meet` AND `treat` now wants a single `hangout` tag, not two,
 * so the mapped list is de-duplicated. Order is preserved, which keeps the
 * write off rows that were already correct.
 */
export const backfillVenueMoods = migrations.define({
  table: "venues",
  migrateOne: (_ctx, venue) => {
    const moods = [...new Set(venue.moods.map(normalizeMood))];
    const same =
      moods.length === venue.moods.length && moods.every((m, i) => m === venue.moods[i]);
    return same ? undefined : { moods };
  },
});
