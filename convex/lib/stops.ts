/**
 * Itinerary recomputation. Every stop swap has to move the times after it and
 * re-total the cost, or the plan quietly lies to the group.
 */

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
};

/** Minutes allowed between stops. Generous on purpose -- nobody is sprinting. */
export const TRAVEL_BUFFER_MIN = 15;

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
