import { describe, expect, it } from "vitest";
import { groupAnswers, type AnswerCard } from "./answers";

const CARDS: AnswerCard[] = [
  { id: "a", text: "walking somewhere green" },
  { id: "b", text: "cold water and a towel" },
  { id: "c", text: "one long meal" },
];

describe("groupAnswers", () => {
  it("keeps a card's order inside its group", () => {
    const groups = groupAnswers(CARDS, { a: "more", b: "less", c: "more" });
    expect(groups.map((g) => g.key)).toEqual(["more", "less"]);
    expect(groups[0].cards.map((c) => c.id)).toEqual(["a", "c"]);
  });

  it("orders the groups the same way whatever the answers are", () => {
    // The heading order is what makes this screen re-readable on a second
    // visit, so it must not follow whichever group happens to be bigger.
    const mostlyLess = groupAnswers(CARDS, { a: "less", b: "less", c: "more" });
    const mostlyMore = groupAnswers(CARDS, { a: "more", b: "more", c: "less" });
    expect(mostlyLess.map((g) => g.key)).toEqual(["more", "less"]);
    expect(mostlyMore.map((g) => g.key)).toEqual(["more", "less"]);
  });

  it("drops an empty group rather than heading a blank", () => {
    const groups = groupAnswers(CARDS, { a: "more", b: "more", c: "more" });
    expect(groups).toHaveLength(1);
    expect(groups[0].cards).toHaveLength(3);
  });

  it("collects the cards with no answer", () => {
    const groups = groupAnswers(CARDS, { a: "more" });
    expect(groups.map((g) => g.key)).toEqual(["more", "unanswered"]);
    expect(groups[1].cards.map((c) => c.id)).toEqual(["b", "c"]);
  });

  it("puts everything under one heading when nothing was ever stored", () => {
    // A profile written before the answers were kept. One honest group beats
    // seven rows of em dashes.
    const groups = groupAnswers(CARDS, undefined);
    expect(groups.map((g) => g.key)).toEqual(["unanswered"]);
    expect(groups[0].cards).toHaveLength(3);
  });

  it("returns nothing at all when there are no cards", () => {
    expect(groupAnswers([], { a: "more" })).toEqual([]);
  });
});
