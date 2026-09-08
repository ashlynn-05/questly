import { describe, expect, test } from "vitest";
import { swipeIntent, swipeThreshold } from "./swipe";

/**
 * The gesture's one decision, tested where the suite can actually reach it.
 * `vitest.config.ts` runs on edge-runtime with no DOM, so a pointer handler is
 * untestable here and a pure function is not -- which is why the threshold
 * lives in `src/lib` rather than inline in the component that drags.
 */
describe("how far is far enough", () => {
  test("a quarter of the card, so the same gesture works at every width", () => {
    expect(swipeThreshold(400)).toBe(100);
  });

  test("narrow cards get a floor, or the threshold is a twitch", () => {
    // 25% of 200 is 50px, which a thumb crosses without meaning to.
    expect(swipeThreshold(200)).toBe(64);
  });
});

describe("which way a drag is leaning", () => {
  test("short of the threshold is not a vote", () => {
    expect(swipeIntent(60, 400)).toBeNull();
    expect(swipeIntent(-60, 400)).toBeNull();
  });

  test("right is yes, left is no", () => {
    expect(swipeIntent(120, 400)).toBe("yes");
    expect(swipeIntent(-120, 400)).toBe("no");
  });

  test("exactly on the threshold commits", () => {
    // The boundary belongs to the committed side: a drag that reaches the mark
    // has been made, and a card that lights a plate and then refuses it is the
    // one behaviour a swipe deck must never have.
    expect(swipeIntent(100, 400)).toBe("yes");
    expect(swipeIntent(-100, 400)).toBe("no");
  });

  test("standing still is not a vote", () => {
    expect(swipeIntent(0, 400)).toBeNull();
  });

  test("a card that has not measured yet cannot be voted on", () => {
    // `offsetWidth` is 0 before layout, and 25% of 0 would make every stray
    // pixel of movement a vote.
    expect(swipeIntent(5, 0)).toBeNull();
    expect(swipeIntent(Number.NaN, 400)).toBeNull();
  });
});
