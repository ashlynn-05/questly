import { expect, test } from "vitest";
import { FINALIZE_RULES, LOCK_RULES, SWIPE_SECONDS_OPTIONS } from "@convex/lib/rules";
import {
  FINALIZE_RULE_LABELS,
  LOCK_RULE_LABELS,
  asOption,
  lockLine,
  proposalCard,
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
  expect(lockLine("vote", true)).toMatch(/majority/);
  expect(lockLine("anyone", true)).toMatch(/anyone can unlock/i);
  // Not the same sentence with a word swapped: the two rules make different
  // controls appear, and copy that reads the same either way is copy nobody
  // reads twice.
  expect(lockLine("vote", true)).not.toBe(lockLine("anyone", true));
});

test("all three lock rules read differently, because all three behave differently", () => {
  // Three answers to issue #11's question, and a host reading the summary has
  // to be able to tell which one is on. Copy that reads the same under two
  // rules is copy that gets one of them wrong.
  const said = new Set(LOCK_RULES.map((rule) => lockLine(rule, true)));
  expect(said.size).toBe(LOCK_RULES.length);
  expect(lockLine("host", true)).toMatch(/only the host/i);
  // And it says unlocking too: a rule that let anyone release the host's lock
  // would leave the host able to protect nothing.
  expect(lockLine("host", true)).toMatch(/unlock/i);
});

test("a room of one is not promised a vote the server will not run", () => {
  // `plans.setLocked` locks directly when the roster is under two, whatever the
  // rule says. The lobby and the plan screen both say this sentence, so this is
  // the one place the two can be kept honest.
  expect(lockLine("vote", false)).toMatch(/still one tap/i);
  expect(lockLine("vote", false)).not.toBe(lockLine("vote", true));
  // The permissive rule needs no caveat: one tap is what it says either way.
  expect(lockLine("anyone", false)).toBe(lockLine("anyone", true));
  // Nor does the host rule -- the host is in every room, including this one.
  expect(lockLine("host", false)).toBe(lockLine("host", true));
});

test("the vote card says the same thing the live region announces", () => {
  // The screen reader hears `proposalLine` and the screen shows `proposalCard`.
  // Both are built from one verb table, and this is what pins them together.
  for (const kind of ["swap", "lock", "unlock"] as const) {
    const card = proposalCard(kind, "Tam", "Nightcap");
    const line = proposalLine(kind, "Tam", "The Gate", "Nightcap");
    expect(card.heading).toBe(`Tam wants to ${kind} this`);
    expect(line.startsWith(`Tam wants to ${kind} `)).toBe(true);
  }
});

test("a lock card never offers a replacement it does not have", () => {
  expect(proposalCard("lock", "Tam", null).detail).toBe("Nobody swaps it while it is locked.");
  expect(proposalCard("unlock", "Tam", null).detail).toBe("It goes back to being swappable.");
  expect(proposalCard("swap", "Tam", "Nightcap").detail).toBe("Nightcap");
});

test("a proposal says what it is actually asking for", () => {
  expect(proposalLine("lock", "Tam", "The Gate", null)).toBe("Tam wants to lock The Gate.");
  expect(proposalLine("unlock", "Tam", "The Gate", null)).toBe("Tam wants to unlock The Gate.");
  expect(proposalLine("swap", "Tam", "The Gate", "Nightcap")).toBe(
    "Tam wants to swap The Gate for Nightcap.",
  );
});

test("the unreachable swap fallback still reads as a sentence", () => {
  // `proposals.open` requires a replacement, so this branch is unreachable
  // rather than defensive. Pinned to the exact string because `not.toMatch(
  // /null/)` passes just as happily for "for undefined." -- and both halves of
  // the copy have to fall back to the same words.
  expect(proposalLine("swap", "Tam", "The Gate", null)).toBe(
    "Tam wants to swap The Gate for somewhere else.",
  );
  expect(proposalCard("swap", "Tam", null).detail).toBe("Somewhere else");
});

test("the lock rule narrows out of a select like the other two", () => {
  // The third consumer of `asOption`, and the one whose values are not numbers.
  expect(asOption(LOCK_RULES, "vote")).toBe("vote");
  expect(asOption(LOCK_RULES, "host")).toBe("host");
  expect(asOption(LOCK_RULES, "nobody")).toBeNull();
});
