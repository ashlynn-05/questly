/**
 * The quiz answers, grouped by what was answered rather than listed by card.
 *
 * WHAT THIS FIXED. `/settings` drew one row per card with the answer on the
 * right: eight rows, a hairline under each, and -- because most people lean one
 * way -- the same word eight times down the right-hand edge. Every row looked
 * identical, so the column of answers carried no shape at all, and the thing a
 * person actually came to check ("what did I say I wanted?") had to be read out
 * of seven repetitions of "More".
 *
 * Grouped, the same eight phrases answer that question at a glance, the
 * repeated word is said once as a heading, and seven of the eight rules go away.
 *
 * ORDER IS FIXED, NOT DATA-DRIVEN: more, then less, then unanswered. A group
 * order that depended on which was longer would move the headings between
 * visits, and this screen is somewhere people come back to.
 *
 * Empty groups are dropped rather than rendered blank -- an "Unanswered"
 * heading with nothing under it reads as a fault. Somebody who answered
 * everything one way gets one group, which is the honest picture.
 *
 * Pure, and here rather than in the page, for the reason every other decision
 * in `src/lib` is: the suite runs one `edge-runtime` environment with no DOM,
 * so a rule that lives inside a component cannot be tested at all.
 */
export type Leaning = "more" | "less";

export type AnswerCard = {
  id: string;
  text: string;
};

export type AnswerGroup = {
  key: Leaning | "unanswered";
  /** The heading. Says the leaning once, so the rows underneath do not. */
  label: string;
  cards: AnswerCard[];
};

const ORDER: ReadonlyArray<{ key: AnswerGroup["key"]; label: string }> = [
  { key: "more", label: "More of" },
  { key: "less", label: "Less of" },
  // Not "Skipped": a card can be unanswered because the quiz predates the
  // answers being stored, which is nobody's decision.
  { key: "unanswered", label: "No answer yet" },
];

export function groupAnswers(
  cards: readonly AnswerCard[],
  answers: Readonly<Record<string, Leaning>> | undefined,
): AnswerGroup[] {
  return ORDER.map(({ key, label }) => ({
    key,
    label,
    cards: cards.filter((card) => (answers?.[card.id] ?? "unanswered") === key),
  })).filter((group) => group.cards.length > 0);
}
