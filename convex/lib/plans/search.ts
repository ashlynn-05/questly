import { v } from "convex/values";
import { priceLevelToCents } from "../scoring";
import type { Slot, Stop } from "../stops";
import { stopValidator } from "../../validators";

export const optionsValidator = v.object({ options: v.array(stopValidator) });

/**
 * Turns Places results into swap candidates for one slot.
 *
 * HONESTY -- the price shown is always the real estimate for the venue, even in
 * a $0 room. `deck.ts` may stamp a free room's candidates at $0 because it
 * restricts the SEARCH to FREE_TYPES first, so the $0 is true there. Here the
 * query is free text: a $0 group that types the name of a fine diner would be
 * shown it at $0 and find out at the table.
 *
 * Nothing REFUSES an over-budget swap -- `applyStopSwap` checks the stop id and
 * the lock, and that is deliberate, because the group is allowed to decide to
 * overspend. What they are not allowed to be is uninformed: `rooms.get`
 * projects `plan.overBudget` from `isOverBudget` against the room's budget, so
 * the one subscription the client reads carries the fact, and the group
 * declines knowingly instead of finding out at the table.
 */
export function toOptions(
  results: Array<{
    id: string; name: string; address: string;
    summary: string | null; priceLevel: string | null;
  }>,
  slot: Slot,
  prefix: string,
): Stop[] {
  return results.slice(0, 6).map((place, i) => {
    const banded = priceLevelToCents(place.priceLevel);
    return {
      id: `${prefix}_${i}`,
      slot,
      placeId: place.id,
      name: place.name,
      // startAt is rewritten by applyStopSwap, so a placeholder is correct here.
      startAt: 0,
      durationMin: 60,
      // A stop must carry a number -- the itinerary totals them -- but an
      // unpriced venue has no number to carry. It contributes 0, which
      // understates the night, and the note says so in the one place the person
      // choosing it will read. That is the lesser of the two errors available:
      // the alternative is inventing a band, which is what put $35 on a public
      // park, and an invented number would be indistinguishable from a real one
      // in `plan.totalPerHeadCents` and in the booking total.
      costPerHeadCents: banded ?? 0,
      note:
        banded === null
          ? `Price unknown -- ${place.summary ?? place.address}`
          : (place.summary ?? place.address),
      source: "manual" as const,
      locked: false,
    };
  });
}
