import { MOOD_IDS, type Mood } from "../deck/scoring";

/**
 * One card in the eight-question opener.
 *
 * `text` is the question on screen. `more` and `less` are what each answer
 * contributes to the sentence that gets embedded, which is not the same thing:
 * the screen speaks to a person, the sentence describes one.
 */
export type QuizCard = {
  id: string;
  text: string;
  /**
   * The activity a "more likely" leans towards, or `null` for the two cards
   * that read the person rather than the night.
   */
  mood: Mood | null;
  /** The phrase a "more likely" contributes. */
  more: string;
  /**
   * The phrase a "less likely" contributes, or `null` when a no says nothing.
   *
   * This is the whole reason the two sides are written out separately. Only the
   * yeses used to be embedded, on purpose: an embedding of "not this" sits near
   * "this" in vector space and poisons the signal. That is right for the six
   * activity cards, where "less likely" is an absence -- somebody who does not
   * want cold water has not told us what they DO want.
   *
   * It is wrong for the last two, where the no is itself a preference. Somebody
   * who does not want a roof has said they want to be outside, and somebody who
   * will not wing it has said they want a plan. Those answers carry as much as
   * the yeses do, so they get their own phrase rather than being thrown away.
   */
  less: string | null;
};

/**
 * Eight more-likely / less-likely cards: the first screen a new person sees.
 *
 * Two per activity, so no activity is over-weighted by having more cards than
 * the others -- which was a real bug in the seven-card version, where three
 * moods had two cards each and the fourth had one, and its affinity score could
 * therefore never reach the same magnitude.
 *
 * The last two are not about a kind of night at all. They are the two facts
 * that change what a good suggestion looks like regardless of the activity:
 * whether somebody wants to be under a roof, and whether they want to know the
 * plan before they leave the house.
 */
export const QUIZ_CARDS: QuizCard[] = [
  {
    id: "green",
    text: "walking somewhere green instead of sitting down",
    mood: "grass",
    more: "walking somewhere green instead of sitting down",
    less: null,
  },
  {
    id: "cold-water",
    text: "cold water and a towel in a bag",
    mood: "grass",
    more: "cold water and a towel in a bag",
    less: null,
  },
  {
    id: "never-done",
    text: "something you have genuinely never done",
    mood: "sidequest",
    more: "something you have genuinely never done",
    less: null,
  },
  {
    id: "detour",
    text: "a long detour for something gloriously stupid",
    mood: "sidequest",
    more: "a long detour for something gloriously stupid",
    less: null,
  },
  {
    id: "long-table",
    text: "one long table and nowhere else to be",
    mood: "hangout",
    more: "one long table and nowhere else to be",
    less: null,
  },
  {
    id: "lean-in",
    text: "somewhere loud enough that you have to lean in",
    mood: "hangout",
    more: "somewhere loud enough that you have to lean in",
    less: null,
  },
  {
    id: "roof",
    text: "a roof over your head, whatever the weather is doing",
    mood: null,
    more: "being under a roof, whatever the weather is doing",
    less: "being outside even when the weather is not helping",
  },
  {
    id: "unplanned",
    text: "finding out where you are going when you get there",
    mood: null,
    more: "finding out where the night is going when it gets there",
    less: "knowing the plan before leaving the house",
  },
];

export type QuizAnswers = Record<string, "more" | "less">;

/**
 * The only valid card ids.
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
 * The sentence that gets embedded.
 *
 * Every answer that means something contributes its phrase; every answer that
 * means nothing contributes nothing. Which of those a "less likely" is, is a
 * property of the card -- see `QuizCard.less`.
 */
export function tasteSentence(answers: QuizAnswers): string {
  const phrases: string[] = [];
  for (const card of QUIZ_CARDS) {
    const answer = answers[card.id];
    if (answer === "more") phrases.push(card.more);
    else if (answer === "less" && card.less !== null) phrases.push(card.less);
  }
  if (!phrases.length) return "open to anything, no strong preferences yet";
  return `enjoys ${phrases.join("; ")}`;
}

export function moodAffinity(answers: QuizAnswers): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(MOOD_IDS.map((id) => [id, 0]));
  for (const card of QUIZ_CARDS) {
    // The personality cards move no activity's score: they describe how a
    // person likes to go out, not which of the three they are after.
    if (card.mood === null) continue;
    if (answers[card.id] === "more") out[card.mood] += 1;
    if (answers[card.id] === "less") out[card.mood] -= 1;
  }
  return out;
}
