"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Move focus to a heading the moment a screen replaces itself under the user.
 *
 * The room shell already owns the focus policy for transitions it can see, the
 * ones keyed on `status`. Two moves happen INSIDE a screen and are invisible to
 * it: the deck answering its last card, which unmounts both swipe buttons, and
 * the plan arriving, which replaces the whole waiting screen including the live
 * region that was in it. Both drop focus to <body> and leave a keyboard user
 * Tabbing from the top of the document (WCAG 2.4.3).
 *
 * `arrived` is tracked from its value on the FIRST render, so landing on a
 * screen that is already in the new state -- a refresh, a second tab -- moves
 * nothing. Only the crossing counts.
 */
export function useFocusOnArrival(
  arrived: boolean,
  ref: RefObject<HTMLElement | null>,
): void {
  const was = useRef(arrived);
  useEffect(() => {
    if (arrived && !was.current) ref.current?.focus();
    was.current = arrived;
  }, [arrived, ref]);
}
