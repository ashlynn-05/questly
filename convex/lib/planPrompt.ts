/**
 * The prompt that turns a matched card into a night out, and the parser that
 * refuses to let a bad model answer become a broken room.
 *
 * Plain module, no Convex imports: it runs inside an action but is a pure
 * function of its input, so it can be unit-tested without a backend.
 */

import { recomputeItinerary, type Slot, type Stop } from "./stops";

export type PlanInput = {
  venueName: string;
  headcount: number;
  budgetPerHeadCents: number;
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

  return [
    `Build a night out in Melbourne for ${input.headcount} people, anchored on ${input.venueName}.`,
    `The mood they picked is "${input.mood}": ${MOOD_BRIEF[input.mood]}`,
    budget,
    "Return 2 to 4 stops as JSON and nothing else, shaped:",
    `{"stops":[{"slot":"meet"|"main"|"after","name":string,"durationMin":number,"costPerHeadCents":number,"note":string}],"shareMessage":string}`,
    'Exactly one stop must be "main" and it must be the anchor venue.',
    "note is one short sentence a friend would actually send.",
    "shareMessage is one line ready to paste into a group chat: where, when, what it costs.",
    "Do not invent prices for the anchor venue beyond the stated budget.",
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
  const free = input.budgetPerHeadCents === 0;

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
      // Integer cents, and rounded rather than truncated: the whole budget is
      // never spent on the anchor, so there is room left for the rest of it.
      costPerHeadCents: free ? 0 : Math.round(input.budgetPerHeadCents * 0.7),
      note: "The main event.",
      source: "llm",
      locked: false,
    },
  ];

  return {
    stops: recomputeItinerary(stops, input.startAt),
    shareMessage: `${input.venueName} at ${timeLabel(input.startAt)} -- ${
      free ? "free" : `about $${Math.round(input.budgetPerHeadCents / 100)} each`
    }. In?`,
  };
}
