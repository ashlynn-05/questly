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
 *
 * `isGroup` is not decoration. `plans.setLocked` applies a lock directly in a
 * room of one whatever the rule says, because `needed(1)` is 1 and a proposal
 * would carry itself -- so a solo room told flatly that "it takes a majority"
 * is told something the server will not do. The rule is still stated, because
 * the host is setting it for the room that is about to exist.
 */
export function lockLine(rule: LockRule, isGroup: boolean): string {
  if (rule !== "vote") return "Anyone can lock a stop, and anyone can unlock it.";
  const rules = "Locking a stop goes to the room: it takes a majority, and so does unlocking.";
  return isGroup ? rules : `${rules} On your own, it is still one tap.`;
}

/** What a room is being asked to agree to. Mirrors `proposalKindValidator`. */
export type ProposalKind = "swap" | "lock" | "unlock";

/**
 * The verb each kind of proposal is asking for.
 *
 * Both the sentence and the card below are built from this one table, which is
 * the whole reason they live together: the plan screen says the same thing
 * twice per stop -- once in the always-mounted live region that announces a
 * vote arriving, and once on the card itself -- and a screen reader being told
 * something different from what is on screen is worse than either wording.
 */
const PROPOSAL_VERB: Record<ProposalKind, string> = {
  swap: "swap",
  lock: "lock",
  unlock: "unlock",
};

/**
 * The stand-in for a swap proposal with no replacement.
 *
 * Unreachable rather than defensive: `proposals.open` declares `replacement`
 * as a required `stopValidator` and is the only writer of a swap row. It exists
 * so a row that somehow lacked one would read as vague instead of as the word
 * "null", and it is one constant so the sentence and the card cannot end up
 * saying two different vague things.
 */
const SOMEWHERE_ELSE = "somewhere else";

/** "Tam wants to lock The Gate." -- what the live region announces. */
export function proposalLine(
  kind: ProposalKind,
  by: string,
  stopName: string,
  replacementName: string | null,
): string {
  if (kind !== "swap") return `${by} wants to ${PROPOSAL_VERB[kind]} ${stopName}.`;
  return `${by} wants to swap ${stopName} for ${replacementName ?? SOMEWHERE_ELSE}.`;
}

/**
 * The two lines on the vote card, which sits under the stop it is about and so
 * does not repeat the stop's name.
 *
 * Here rather than as ternaries in the JSX because this repo has no DOM test
 * harness by design -- copy left in a component is copy no test can reach, and
 * the three branches are exactly the sort that get half-updated.
 */
export function proposalCard(
  kind: ProposalKind,
  by: string,
  replacementName: string | null,
): { heading: string; detail: string } {
  const heading = `${by} wants to ${PROPOSAL_VERB[kind]} this`;
  if (kind === "lock") return { heading, detail: "Nobody swaps it while it is locked." };
  if (kind === "unlock") return { heading, detail: "It goes back to being swappable." };
  const name = replacementName ?? SOMEWHERE_ELSE;
  return { heading, detail: `${name[0].toUpperCase()}${name.slice(1)}` };
}
