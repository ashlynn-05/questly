import { MOOD_IDS, type Mood } from "@convex/lib/deck/scoring";
import { WHEN_IDS, isValidDateValue, isValidMinutes, type WhenId } from "./when";

/**
 * The twelve taps that open a room, kept somewhere a page load cannot destroy.
 *
 * `/start` holds the whole funnel -- eight quiz cards, the activity, the
 * party, the constraints -- in component state. A signed-out visitor gets all
 * the way to "Open the room", is told they need an account, signs in, comes
 * back to `/start`, and answers the identical twelve questions again from zero.
 * The quiz answers are gone too: `profiles.saveQuiz` needs an identity, so it
 * failed on the way through and `profiles.me` is still null on the way back.
 *
 * So the funnel is written down. `sessionStorage`, not `localStorage`: this is
 * one sitting, and a half-finished funnel from last Tuesday resurfacing on a
 * shared laptop is a worse bug than the one being fixed. Everything here
 * degrades the way `src/lib/session.ts` degrades -- memory first, because that
 * is the half that cannot fail, and the persisted half is the bonus.
 */

export type Step = "quiz" | "mood" | "party" | "company" | "constraints";

/**
 * Who the night is with, which is two questions rather than one.
 *
 * `null` until the party screen is answered. "With people" is not a value here:
 * it is the branch that leads to the company screen, and the answer that comes
 * back from there is `friends` or `strangers`.
 */
export type Company = "alone" | "friends" | "strangers";

export const COMPANY_IDS: readonly Company[] = ["alone", "friends", "strangers"];

/** Every value the funnel collects, and the one fact about what happened to it. */
export type FunnelDraft = {
  step: Step | null;
  answers: Record<string, "more" | "less">;
  cardIndex: number;
  mood: Mood | null;
  company: Company | null;
  visibility: "private" | "open";
  headcount: number;
  budget: number;
  radiusKm: number;
  whenId: WhenId;
  /**
   * The time of day the host chose, as minutes since local midnight, or `null`
   * to follow the preset `whenId` names.
   *
   * Minutes, NEVER an epoch. A timestamp written down here would be the exact
   * bug the comment below is about: a draft restored tomorrow would carry
   * yesterday's absolute time instead of tomorrow's "Tonight". See
   * `src/lib/when.ts`, which turns the pair into a timestamp at the moment the
   * room is opened and nowhere else.
   */
  whenMinutes: number | null;
  /**
   * The day the host picked, as `YYYY-MM-DD`, or `null` for every `whenId`
   * that names its own day.
   *
   * A CALENDAR DATE IS NOT A TIMESTAMP, which is why this one is allowed to be
   * written down while `whenMinutes` above forbids an epoch. "Tonight" has to
   * be re-resolved tomorrow because it means a different day tomorrow. The 3rd
   * of October means the 3rd of October on whatever day the draft comes back,
   * and re-resolving it would be the bug rather than the fix.
   */
  whenDate: string | null;
  /**
   * Whether `profiles.saveQuiz` actually stored these answers. False after a
   * signed-out visitor finishes the quiz, which is what lets `/start` retry the
   * save once they have an identity instead of silently throwing the answers
   * away.
   */
  quizSaved: boolean;
};

export const STEPS: readonly Step[] = ["quiz", "mood", "party", "company", "constraints"];
export const BUDGETS: readonly number[] = [0, 2000, 3000, 5000, 8000];
export const HEADCOUNTS: readonly number[] = [1, 2, 3, 4, 5, 6];
export const RADII: readonly number[] = [2, 5, 10, 20];

export const EMPTY_DRAFT: FunnelDraft = {
  step: null,
  answers: {},
  cardIndex: 0,
  mood: null,
  company: null,
  visibility: "private",
  headcount: 4,
  budget: 0,
  radiusKm: 5,
  whenId: "tonight",
  whenMinutes: null,
  whenDate: null,
  quizSaved: false,
};

const KEY = "questly-funnel";

/**
 * Everything that comes back out of a browser store is a string somebody could
 * have typed, so nothing is trusted on the way in.
 *
 * Unknown values do not fail the whole draft -- they fall back to the empty
 * draft's value for that one field. Losing a mis-stored budget is a smaller
 * harm than throwing away eleven other answers, and the server validates every
 * one of these again at `rooms.create` regardless. Only a payload that is not
 * an object at all is refused outright.
 */
export function parseDraft(raw: string | null): FunnelDraft | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const d = value as Record<string, unknown>;

  const oneOf = <T>(candidate: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(candidate as T) ? (candidate as T) : fallback;

  const answers: Record<string, "more" | "less"> = {};
  if (typeof d.answers === "object" && d.answers !== null && !Array.isArray(d.answers)) {
    for (const [id, answer] of Object.entries(d.answers as Record<string, unknown>)) {
      if (answer === "more" || answer === "less") answers[id] = answer;
    }
  }

  return {
    step: STEPS.includes(d.step as Step) ? (d.step as Step) : null,
    answers,
    cardIndex:
      typeof d.cardIndex === "number" && Number.isInteger(d.cardIndex) && d.cardIndex >= 0
        ? d.cardIndex
        : 0,
    mood: MOOD_IDS.includes(d.mood as Mood) ? (d.mood as Mood) : null,
    company: COMPANY_IDS.includes(d.company as Company) ? (d.company as Company) : null,
    visibility: d.visibility === "open" ? "open" : "private",
    headcount: oneOf(d.headcount, HEADCOUNTS, EMPTY_DRAFT.headcount),
    budget: oneOf(d.budget, BUDGETS, EMPTY_DRAFT.budget),
    radiusKm: oneOf(d.radiusKm, RADII, EMPTY_DRAFT.radiusKm),
    // An allow-list, like every other constrained field here. This used to be a
    // bare `typeof d.whenId === "string"`, which was harmless only because
    // `/start` looked the id up and fell back -- now that the id also selects a
    // preset TIME, an unknown one has to be refused where the rest are.
    whenId: oneOf(d.whenId, WHEN_IDS, EMPTY_DRAFT.whenId),
    whenMinutes: isValidMinutes(d.whenMinutes) ? d.whenMinutes : EMPTY_DRAFT.whenMinutes,
    whenDate: isValidDateValue(d.whenDate) ? d.whenDate : EMPTY_DRAFT.whenDate,
    quizSaved: d.quizSaved === true,
  };
}

/**
 * The same keys in memory, for the browsers that refuse to keep them.
 *
 * `sessionStorage` THROWS in Safari's "Block All Cookies", in some embedded
 * webviews and in a few private-browsing modes. A module-level value survives a
 * client-side navigation within one tab, so it still carries the funnel across
 * an in-app step change -- it just cannot carry it across the full page load a
 * sign-in round trip performs. That is the honest limit: with storage refused
 * the funnel is no worse than it is today, and with storage allowed it survives.
 */
let memory: string | null = null;

/**
 * The restore point, read ONCE and then frozen for the life of the page.
 *
 * This is what `/start` hands to `useSyncExternalStore`, which requires a
 * snapshot that is stable by reference between renders or it re-renders
 * forever. Freezing it is also what the page wants: this is "what was on screen
 * when we left", not a live mirror of the store. Later writes go to
 * `writeDraft` and are picked up by the next page load, never mid-render.
 */
let restorePoint: FunnelDraft | null | undefined;

export function writeDraft(draft: FunnelDraft) {
  const raw = JSON.stringify(draft);
  memory = raw;
  try {
    sessionStorage.setItem(KEY, raw);
  } catch {
    // Only survival across a reload is lost.
  }
}

export function forgetDraft() {
  memory = null;
  restorePoint = undefined;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing was stored to remove.
  }
}

export function restoredDraft(): FunnelDraft | null {
  if (restorePoint !== undefined) return restorePoint;
  let raw = memory;
  if (raw === null) {
    try {
      raw = sessionStorage.getItem(KEY);
    } catch {
      raw = null;
    }
  }
  restorePoint = parseDraft(raw);
  return restorePoint;
}

/**
 * The restore point never changes, so there is nothing to subscribe to -- but
 * `useSyncExternalStore` requires a subscribe function, and it must be stable
 * or React re-subscribes on every render.
 */
export function subscribeToDraft(): () => void {
  return () => {};
}

/** SSR and the hydration render see no draft, because neither has a store. */
export function noDraft(): FunnelDraft | null {
  return null;
}

/** Test seam: drop the frozen restore point so the next read goes to storage. */
export function resetDraftForTests() {
  memory = null;
  restorePoint = undefined;
}

/**
 * The screen a Back tap returns to, or `null` where there is nothing behind.
 *
 * A map from step to step cannot express this any more. The constraints screen
 * is reached two ways -- straight from "on your own", or through the
 * friends-or-strangers screen -- and sending somebody alone back to a question
 * they were never asked is how a Back button starts lying. So the answer
 * depends on the draft, not only on the step.
 *
 * The quiz is answered forwards only, and the activity screen is the first
 * thing after it, so both stop here.
 */
export function backFrom(step: Step, draft: FunnelDraft): Step | null {
  switch (step) {
    case "quiz":
    case "mood":
      return null;
    case "party":
      return "mood";
    case "company":
      return "party";
    case "constraints":
      return draft.company === "alone" ? "party" : "company";
  }
}
