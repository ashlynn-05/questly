import type { FinalizeRule, LockRule } from "@convex/lib/rules";

/**
 * The words the three house rules are shown in, and the sentences that say
 * what a room is currently set to.
 *
 * Here rather than in the lobby because the plan screen says the same thing at
 * the moment it matters -- and because a `<select>` whose option labels and
 * whose summary sentence disagree is how a host ends up sure they picked
 * something else.
 */

export const FINALIZE_RULE_LABELS: Record<FinalizeRule, string> = {
  anyone: "Anyone in the room",
  host: "Only the host",
  majority: "Most of you",
  all: "Everyone",
};

/** How the rule reads in a sentence, as the thing that has to happen. */
export const FINALIZE_RULE_SENTENCES: Record<FinalizeRule, string> = {
  anyone: "anyone in the room can book it",
  host: "only the host can book it",
  majority: "most of you have to say yes before it books",
  all: "everyone has to say yes before it books",
};

/** "30 seconds a card, and most of you have to say yes before it books." */
export function rulesLine(swipeSeconds: number, rule: FinalizeRule): string {
  const timer =
    swipeSeconds > 0 ? `${swipeSeconds} seconds a card` : "no timer on the cards";
  return `${timer[0].toUpperCase()}${timer.slice(1)}, and ${FINALIZE_RULE_SENTENCES[rule]}.`;
}

/**
 * The value a `<select>` handed back, as the option it names, or null.
 *
 * A change event carries a string whatever the option was, and the mutation
 * takes a union of specific literals -- so something has to turn one into the
 * other. Finding it in the offered list does that WITHOUT a type assertion:
 * the element that comes back out of the array is already the right literal
 * type, and a value nobody offered comes back as null rather than as a cast
 * lie that the server would then have to refuse.
 */
export function asOption<T extends string | number>(
  options: readonly T[],
  value: string,
): T | null {
  return options.find((option) => String(option) === value) ?? null;
}

export const LOCK_RULE_LABELS: Record<LockRule, string> = {
  anyone: "Anyone, in one tap",
  vote: "The room votes on it",
};

/**
 * The lock rule as its own line rather than a third clause in `rulesLine`.
 *
 * Two reasons, and the first is just readability -- three clauses joined by
 * commas is a sentence nobody finishes. The second matters more: this rule is
 * the one that changes what a control DOES, so the plan screen shows it next to
 * that control, where `rulesLine` is not.
 */
export function lockLine(rule: LockRule): string {
  return rule === "vote"
    ? "Locking a stop goes to the room: it takes a majority, and so does unlocking."
    : "Anyone can lock a stop, and anyone can unlock it.";
}

/**
 * What one open proposal is asking for, in one sentence.
 *
 * Here rather than inline in the plan screen because the same sentence is said
 * twice per stop -- once in the always-mounted live region that announces a
 * vote arriving, and once on the card itself -- and a screen reader being told
 * something different from what is on screen is worse than either wording.
 */
export function proposalLine(
  kind: "swap" | "lock" | "unlock",
  by: string,
  stopName: string,
  replacementName: string | null,
): string {
  if (kind === "lock") return `${by} wants to lock ${stopName}.`;
  if (kind === "unlock") return `${by} wants to unlock ${stopName}.`;
  // A swap always has a replacement -- `proposals.open` requires one -- so the
  // fallback is unreachable rather than a real case. It exists so a row that
  // somehow lacked one would read as vague instead of as the word "null".
  return `${by} wants to swap ${stopName} for ${replacementName ?? "somewhere else"}.`;
}
