import { expect, test } from "vitest";
import { bookedHeadcount } from "../../../../src/lib/room/booking";

/**
 * The defect: a booked room went on saying "Going 4" after one of the four
 * left. Nothing stood behind the 4 -- the roster had three people in it -- and
 * PRODUCT.md's honesty rule does not have an exemption for a number that used
 * to be true.
 *
 * These assert both halves of the ruling: the live number is what "Going"
 * means, and the frozen record does NOT move to match it.
 */

/** Four people agreed to $28 each. */
const BOOKING = { headcount: 4, totalCents: 11_200 };

test("nobody has left, so there is one number and nothing to explain", () => {
  const shown = bookedHeadcount(BOOKING, 4);
  expect(shown).toEqual({ going: 4, agreed: 4, changed: false, perHeadCents: 2800 });
});

test("someone left, so the screen has both numbers to show", () => {
  const shown = bookedHeadcount(BOOKING, 3);
  expect(shown.going).toBe(3);
  expect(shown.agreed).toBe(4);
  expect(shown.changed).toBe(true);
});

test("the per-head estimate is the one the group agreed to, not one re-divided after the fact", () => {
  // 11200/3 is $37.33 -- a number nobody in that room has ever seen or agreed
  // to. The booking is a record of what was agreed, so the split stays the
  // agreed split and the screen says what it was split between.
  expect(bookedHeadcount(BOOKING, 3).perHeadCents).toBe(2800);
  expect(bookedHeadcount(BOOKING, 1).perHeadCents).toBe(2800);
  expect(bookedHeadcount(BOOKING, 4).perHeadCents).toBe(2800);
});

test("a free night stays free however the roster moves", () => {
  expect(bookedHeadcount({ headcount: 5, totalCents: 0 }, 2)).toEqual({
    going: 2,
    agreed: 5,
    changed: true,
    perHeadCents: 0,
  });
});

test("a roster that somehow grew is a difference too, not a special case", () => {
  // `rooms.join` refuses a booked room today, so this cannot happen -- which is
  // exactly why it is asserted: the honest branch must not depend on that.
  const shown = bookedHeadcount(BOOKING, 5);
  expect(shown.changed).toBe(true);
  expect(shown.agreed).toBe(4);
});

test("an agreed headcount of zero does not produce a division by it", () => {
  const shown = bookedHeadcount({ headcount: 0, totalCents: 0 }, 0);
  expect(shown.perHeadCents).toBe(0);
  expect(Number.isFinite(shown.perHeadCents)).toBe(true);
});
