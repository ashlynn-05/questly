/**
 * The prompt that turns a matched card into a night out, and the parser that
 * refuses to let a bad model answer become a broken room.
 *
 * Plain module, no Convex imports: it runs inside an action but is a pure
 * function of its input, so it can be unit-tested without a backend.
 */

import { recomputeItinerary, totalPerHeadCents, type Slot, type Stop } from "./stops";

export type PlanInput = {
  venueName: string;
  headcount: number;
  budgetPerHeadCents: number;
  /**
   * What the matched card says the anchor venue costs per head, or `null` when
   * Google gave it no price signal.
   *
   * This is a fact about the VENUE and is the only thing the anchor stop may be
   * priced at. It is deliberately separate from `budgetPerHeadCents`, which is a
   * fact about the GROUP: the fallback night used to price the anchor at 70% of
   * the budget, so the same venue on the same evening cost $21 a head for a $30
   * room and $49 for a $70 one, and that number went on to become the booking
   * total. A budget is what a group is willing to pay, never evidence of what
   * anything costs.
   */
  anchorPriceCents: number | null;
  startAt: number;
  mood: "grass" | "meet" | "treat" | "new";
};

const SLOTS: Slot[] = ["meet", "main", "after"];

/** What each mood actually asks for, in words the model can act on. */
const MOOD_BRIEF: Record<PlanInput["mood"], string> = {
  grass: "outdoors and unhurried -- parks, riverside, fresh air.",
  meet: "easy to talk over -- somewhere a group can actually hear each other.",
  treat: "a bit special, the night they will talk about afterwards.",
  new: "somewhere they are unlikely to have been before.",
};

export function buildPlanPrompt(input: PlanInput): string {
  const budget =
    input.budgetPerHeadCents === 0
      ? "The budget is $0 per head. Every stop must genuinely cost nothing."
      : `The budget is $${Math.round(input.budgetPerHeadCents / 100)} per head across the whole night.`;

  // The anchor's price is stated as a fact, or its absence is. Either way the
  // model is told not to make one up: it has no more information about this
  // venue's prices than we do, and a plausible-looking number from a language
  // model is exactly the kind of invention that ends up in a booking total.
  const anchorPrice =
    input.anchorPriceCents === null
      ? `We do not have a price for ${input.venueName}. Use 0 for its costPerHeadCents and say in its note that the price needs checking. Do not guess one.`
      : `${input.venueName} costs about $${Math.round(input.anchorPriceCents / 100)} per head. Use exactly that for its costPerHeadCents.`;

  return [
    `Build a night out in Melbourne for ${input.headcount} people, anchored on ${input.venueName}.`,
    `The mood they picked is "${input.mood}": ${MOOD_BRIEF[input.mood]}`,
    budget,
    anchorPrice,
    "Return 2 to 4 stops as JSON and nothing else, shaped:",
    `{"stops":[{"slot":"meet"|"main"|"after","name":string,"durationMin":number,"costPerHeadCents":number,"note":string}],"shareMessage":string}`,
    'Exactly one stop must be "main" and it must be the anchor venue.',
    "note is one short sentence a friend would actually send.",
    "shareMessage is one line ready to paste into a group chat: where, when, what it costs.",
    "Do not invent prices for any stop. If you do not know one, use 0 and say so in the note.",
  ].join("\n");
}

let counter = 0;
const nextId = () => `stop_${Date.now().toString(36)}_${(counter++).toString(36)}`;

/**
 * Never throws. A model that returns prose instead of JSON must still degrade
 * into a usable night, because this runs *after* the match -- the room has
 * already committed and there is nowhere to send them back to.
 *
 * `input` is the real room, not a placeholder: when this falls back it has to
 * describe the venue that room actually matched on, at their headcount and
 * their budget. A degraded plan is acceptable; a plan about the wrong night is
 * not, and that is the path a live demo hits whenever OpenAI is slow.
 */
export function parsePlanResponse(
  text: string,
  input: PlanInput,
): { stops: Stop[]; shareMessage: string } {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("no json");

    const raw = JSON.parse(text.slice(start, end + 1)) as {
      stops?: Array<Record<string, unknown>>;
      shareMessage?: unknown;
    };
    if (!Array.isArray(raw.stops) || raw.stops.length === 0) throw new Error("no stops");

    // Every field is coerced, never trusted: this is model output arriving at a
    // schema, and one string where a number belongs would fail the write for a
    // room that has already matched.
    const stops: Stop[] = raw.stops.slice(0, 4).map((s) => ({
      id: nextId(),
      slot: SLOTS.includes(s.slot as Slot) ? (s.slot as Slot) : "main",
      name: typeof s.name === "string" && s.name.trim() ? s.name.trim() : "A stop",
      startAt: input.startAt,
      durationMin: typeof s.durationMin === "number" && s.durationMin > 0 ? s.durationMin : 45,
      costPerHeadCents:
        typeof s.costPerHeadCents === "number" && s.costPerHeadCents >= 0
          ? Math.round(s.costPerHeadCents)
          : 0,
      note: typeof s.note === "string" ? s.note : "",
      source: "llm",
      locked: false,
    }));

    return {
      stops: recomputeItinerary(stops, input.startAt),
      shareMessage:
        typeof raw.shareMessage === "string" && raw.shareMessage.trim()
          ? raw.shareMessage.trim()
          : "Plan's set -- see you there.",
    };
  } catch {
    return fallbackPlan(input);
  }
}

/**
 * The one formatting call in the last-resort path, and the only thing in it
 * that can throw: a runtime without the Melbourne time zone in its ICU data
 * would take `fallbackPlan` down with it, and nothing catches that.
 */
function timeLabel(startAt: number): string {
  try {
    return new Date(startAt).toLocaleTimeString("en-AU", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "Australia/Melbourne",
    });
  } catch {
    return `${new Date(startAt).toISOString().slice(11, 16)} UTC`;
  }
}

/** The canned night. Used when OpenAI is unavailable, so the demo cannot stall. */
export function fallbackPlan(input: PlanInput): { stops: Stop[]; shareMessage: string } {
  const unpriced = input.anchorPriceCents === null;

  const stops: Stop[] = [
    {
      id: nextId(),
      slot: "meet",
      name: `Meet outside ${input.venueName}`,
      startAt: input.startAt,
      durationMin: 15,
      costPerHeadCents: 0,
      note: "Whoever gets there first grabs a spot.",
      source: "llm",
      locked: false,
    },
    {
      id: nextId(),
      slot: "main",
      name: input.venueName,
      startAt: input.startAt,
      durationMin: 75,
      // The venue's own price, integer cents, and nothing derived from the
      // group's wallet. `null` contributes 0 -- a stop has to carry a number --
      // and the note is where that is admitted, because 0 in the total would
      // otherwise read as "this stop is free".
      costPerHeadCents: input.anchorPriceCents ?? 0,
      note: unpriced
        ? "The main event. We could not get a price for this one -- worth checking before you go."
        : "The main event.",
      source: "llm",
      locked: false,
    },
  ];

  const recomputed = recomputeItinerary(stops, input.startAt);
  // The share message quotes the night that was actually built, not the budget
  // that was asked for. Quoting the budget meant a group whose $0 night came
  // out at $18 read "free" in the message they pasted into the group chat.
  const total = totalPerHeadCents(recomputed);
  const cost = unpriced
    ? "price to confirm"
    : total === 0
      ? "free"
      : `about $${Math.round(total / 100)} each`;

  return {
    stops: recomputed,
    shareMessage: `${input.venueName} at ${timeLabel(input.startAt)} -- ${cost}. In?`,
  };
}
