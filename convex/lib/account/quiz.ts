import type { Mood } from "../deck/scoring";

/**
 * Seven more-likely / less-likely cards. Kept short on purpose: this sits
 * between a new user and their first room, so it is the one screen where every
 * extra card costs a signup.
 */
export const QUIZ_CARDS: Array<{ id: string; text: string; mood: Mood }> = [
  { id: "walk", text: "walking somewhere green instead of sitting down", mood: "grass" },
  { id: "swim", text: "cold water and a towel in a bag", mood: "grass" },
  { id: "strangers", text: "a room where you know one person out of ten", mood: "meet" },
  { id: "loud", text: "somewhere loud enough that you have to lean in", mood: "meet" },
  { id: "long-lunch", text: "one long meal instead of three quick stops", mood: "treat" },
  { id: "spend", text: "spending the whole budget in one good place", mood: "treat" },
  { id: "never-done", text: "something you have genuinely never done", mood: "new" },
];

export type QuizAnswers = Record<string, "more" | "less">;

/**
 * The only valid card ids, in the same shape and for the same reason as
 * `GOAL_IDS` below.
 *
 * This did not matter while the answers were only ever summed on the way past:
 * `tasteSentence` and `moodAffinity` both iterate `QUIZ_CARDS` and simply never
 * look at a key that is not one of them, so an invented key was inert. It
 * matters now that the answers are STORED and read back to the person on
 * `/settings` -- an unvalidated `v.record(v.string(), ...)` would let a client
 * write arbitrary keys into a row the product then renders.
 */
export const CARD_IDS: ReadonlySet<string> = new Set(QUIZ_CARDS.map((c) => c.id));

/**
 * The eighth question: not a card to react to, but what the night is actually
 * for. Multi-select, because "meeting people" and "a story worth telling" are
 * not mutually exclusive. Same voice as the cards above -- confident, a little
 * funny, never silly.
 */
export const QUIZ_GOALS: Array<{ id: string; text: string }> = [
  { id: "meet-people", text: "leaving with a new name in your phone" },
  { id: "reset", text: "coming back calmer than you left" },
  { id: "celebrate", text: "making an ordinary week feel like an occasion" },
  { id: "worth-telling", text: "having a story worth telling on Monday" },
  { id: "stretch-budget", text: "getting the most out of not much money" },
];

/** The only valid goal ids -- anything else is a client bug, not a preference. */
export const GOAL_IDS: ReadonlySet<string> = new Set(QUIZ_GOALS.map((g) => g.id));

/**
 * The sentence is what gets embedded. Only the yeses go in -- an embedding of
 * "not this" sits near "this" in vector space and would poison the signal.
 * Goals fold in the same way: they describe what a good night does, which
 * belongs in the same taste sentence as what a good night looks like.
 */
export function tasteSentence(answers: QuizAnswers, goals: string[] = []): string {
  const liked = QUIZ_CARDS.filter((c) => answers[c.id] === "more").map((c) => c.text);
  const goalPhrases = QUIZ_GOALS.filter((g) => goals.includes(g.id)).map((g) => g.text);

  const parts: string[] = [];
  if (liked.length) parts.push(`enjoys ${liked.join("; ")}`);
  if (goalPhrases.length) parts.push(`is going out for ${goalPhrases.join("; ")}`);

  if (!parts.length) return "open to anything, no strong preferences yet";
  return parts.join(". ");
}

export function moodAffinity(answers: QuizAnswers): Record<string, number> {
  const out: Record<string, number> = { grass: 0, meet: 0, treat: 0, new: 0 };
  for (const card of QUIZ_CARDS) {
    if (answers[card.id] === "more") out[card.mood] += 1;
    if (answers[card.id] === "less") out[card.mood] -= 1;
  }
  return out;
}
