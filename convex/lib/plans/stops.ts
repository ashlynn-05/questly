/**
 * Itinerary recomputation. Every stop swap has to move the times after it and
 * re-total the cost, or the plan quietly lies to the group.
 */

import { throwUserError } from "../errors";

export type Slot = "meet" | "main" | "after";

export type Stop = {
  id: string;
  slot: Slot;
  placeId?: string;
  name: string;
  startAt: number;
  durationMin: number;
  costPerHeadCents: number;
  note: string;
  source: "llm" | "places" | "manual" | "partner";
  locked: boolean;
  lockedBy?: string;
};

/** Minutes allowed between stops. Generous on purpose -- nobody is sprinting. */
export const TRAVEL_BUFFER_MIN = 15;

/**
 * What a stop is called when the model returned no usable name.
 *
 * Here rather than beside the parser that writes it, because the browser reads
 * it too: `src/lib/room/maps.ts` drops these before asking Google for a route,
 * since "A stop" geocodes to noise and a confidently wrong pin on the plan
 * screen is worse than a stop the map does not draw. This module is the small
 * one to import for that -- `prompt.ts` would drag the whole prompt and parser
 * into the client bundle for one string.
 *
 * A shared constant rather than the same literal in two files, so renaming it
 * turns `tests/src/lib/room/maps.test.ts` red instead of silently breaking the
 * map.
 */
export const UNNAMED_STOP = "A stop";

/** Rewrites every startAt from the first stop forward. Pure. */
export function recomputeItinerary(stops: Stop[], startAt: number): Stop[] {
  let cursor = startAt;
  return stops.map((stop, i) => {
    const at = i === 0 ? startAt : cursor;
    cursor = at + (stop.durationMin + TRAVEL_BUFFER_MIN) * 60_000;
    return { ...stop, startAt: at };
  });
}

export function totalPerHeadCents(stops: Stop[]): number {
  return stops.reduce((sum, s) => sum + s.costPerHeadCents, 0);
}

export function isOverBudget(stops: Stop[], budgetPerHeadCents: number): boolean {
  return totalPerHeadCents(stops) > budgetPerHeadCents;
}

/**
 * The absolute ceiling on what one stop may claim to cost per head, whatever
 * the room's budget. $1,000 a head is past every real Melbourne venue and well
 * past anything this product plans, so a number above it is a bug or a lie
 * rather than an expensive night.
 */
const STOP_PRICE_CEILING_CENTS = 100_000;

/**
 * The floor under the budget-relative ceiling, so a $0 room still has room to
 * decide to spend something. Without it a free room's ceiling would be $0 and
 * every swap in it would be refused.
 */
const MIN_STOP_PRICE_CEILING_CENTS = 20_000;

/** How far over its own budget a room is allowed to price a single stop. */
const BUDGET_CEILING_MULTIPLE = 5;

/**
 * Take a client-authored replacement stop and return one this room may store.
 *
 * WHAT IS STILL TRUSTED, and why the full fix is deferred.
 *
 * `name`, `note`, `placeId`, `durationMin` and the price MAGNITUDE all still
 * come from the client. Nothing here makes the price TRUE -- only bounded. The
 * real fix is to store the candidates `plans.searchStop` and `plans.suggestStop`
 * produce in their own table and have the edit paths take a candidate id, so the
 * server reads the stop it authored instead of being handed one. That is a
 * schema change and a change to three client call sites, and it is ledgered
 * rather than done in this round.
 *
 * WHAT THIS DOES STOP, today:
 *
 *  - `source` is never accepted from the client. It is a provenance claim, and
 *    `"partner"` is a COMMERCIAL one -- the tier `deck.ts` reserves for venues
 *    with an actual offer, and the tier the card renders a partner badge for. A
 *    member could previously mint one by hand: propose "Vue de Monde,
 *    $5/head, source: partner", have the room vote it through on the strength
 *    of a discount that does not exist, and book it. This path cannot verify
 *    provenance for any value, so it records the only thing it can stand
 *    behind: a person put this here.
 *
 *  - the price is range-checked. It does not stop a plausible lie, but it does
 *    stop a nonsense one -- a negative, a fraction of a cent, an infinity, or a
 *    number large enough to make `plan.totalPerHeadCents` meaningless -- and
 *    those are the likelier cause here. The attacker is a peer holding a
 *    sessionKey they were legitimately issued; a mis-populated object from a
 *    client bug mis-prices a booking exactly as effectively as malice, and with
 *    far higher odds.
 *
 * The ceiling is generous ON PURPOSE. Nothing refuses an over-budget swap -- the
 * group is allowed to decide to overspend, and `rooms.get` projects
 * `plan.overBudget` so they decide knowingly. This is a sanity bound, not a
 * budget rule.
 */
export function sanitizeClientStop(replacement: Stop, budgetPerHeadCents: number): Stop {
  const ceiling = Math.min(
    STOP_PRICE_CEILING_CENTS,
    Math.max(budgetPerHeadCents * BUDGET_CEILING_MULTIPLE, MIN_STOP_PRICE_CEILING_CENTS),
  );

  const cost = replacement.costPerHeadCents;
  if (!Number.isInteger(cost) || cost < 0 || cost > ceiling) {
    throwUserError(
      "STOP_PRICE_INVALID",
      `That price does not look right. A stop can cost up to $${Math.round(ceiling / 100)} a head.`,
    );
  }

  return { ...replacement, source: "manual" };
}
