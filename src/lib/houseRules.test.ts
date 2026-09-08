import { expect, test } from "vitest";
import { FINALIZE_RULES, LOCK_RULES, SWIPE_SECONDS_OPTIONS } from "@convex/lib/rules";
import {
  FINALIZE_RULE_LABELS,
  LOCK_RULE_LABELS,
  asOption,
  lockLine,
  proposalLine,
  rulesLine,
} from "./houseRules";

/**
 * The words on the two controls, and the narrowing that gets a `<select>`'s
 * string back to the literal the mutation takes.
 */

test("every rule the server accepts has words to show it in", () => {
  // The lobby maps over `FINALIZE_RULES` to build its options, so a rule added
  // to the server with no label would render an empty one.
  for (const rule of FINALIZE_RULES) {
    expect(FINALIZE_RULE_LABELS[rule]).toBeTruthy();
  }
});

test("the summary says both halves of the rule, and says off honestly", () => {
  expect(rulesLine(30, "majority")).toBe(
    "30 seconds a card, and most of you have to say yes before it books.",
  );
  expect(rulesLine(0, "anyone")).toBe(
    "No timer on the cards, and anyone in the room can book it.",
  );
  expect(rulesLine(0, "all")).toMatch(/^No timer on the cards/);
});

test("a value that was offered comes back as itself", () => {
  expect(asOption(SWIPE_SECONDS_OPTIONS, "30")).toBe(30);
  expect(asOption(SWIPE_SECONDS_OPTIONS, "0")).toBe(0);
  expect(asOption(FINALIZE_RULES, "host")).toBe("host");
});

test("a value nobody offered is null, not a cast lie", () => {
  // The point of the helper: without it the change handler would have to
  // assert a string into a union of literals, and the server would be the
  // first thing to find out it was wrong.
  expect(asOption(SWIPE_SECONDS_OPTIONS, "45")).toBeNull();
  expect(asOption(SWIPE_SECONDS_OPTIONS, "")).toBeNull();
  expect(asOption(FINALIZE_RULES, "nobody")).toBeNull();
});

test("both lock rules have words, and the sentence says which one is on", () => {
  for (const rule of LOCK_RULES) {
    expect(LOCK_RULE_LABELS[rule]).toBeTruthy();
  }
  expect(lockLine("vote")).toMatch(/majority/);
  expect(lockLine("anyone")).toMatch(/anyone can unlock/i);
  // Not the same sentence with a word swapped: the two rules make different
  // controls appear, and copy that reads the same either way is copy nobody
  // reads twice.
  expect(lockLine("vote")).not.toBe(lockLine("anyone"));
});

test("a proposal says what it is actually asking for", () => {
  expect(proposalLine("lock", "Tam", "The Gate", null)).toBe("Tam wants to lock The Gate.");
  expect(proposalLine("unlock", "Tam", "The Gate", null)).toBe("Tam wants to unlock The Gate.");
  expect(proposalLine("swap", "Tam", "The Gate", "Nightcap")).toBe(
    "Tam wants to swap The Gate for Nightcap.",
  );
});

test("a lock proposal never mentions a replacement it does not have", () => {
  // The screen reads `replacement?.name ?? null` off a nullable field, so the
  // null path has to produce a sentence rather than the word "null".
  expect(proposalLine("lock", "Tam", "The Gate", null)).not.toMatch(/null|swap/i);
  expect(proposalLine("swap", "Tam", "The Gate", null)).not.toMatch(/null/i);
});
