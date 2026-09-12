"use client";

import { useRef } from "react";
import { useCursorDrift, useScrollDrift } from "./useCursorDrift";

/**
 * The two radial washes behind the hero, and the only two things on the first
 * screen that move before you have done anything.
 *
 * Both drifts are on, and they answer different questions. The pointer drift is
 * the design's own `data-cursor`, at its own strengths: -30 on the upper rail
 * wash and 34 on the lower action wash, so they separate as the cursor crosses
 * and the hero reads as having depth rather than a painted backdrop. The scroll
 * drift is not in the comp; it is here because the pointer drift does nothing
 * on the device this product is used on, and a first screen that does not
 * respond to the very first flick is a first screen that reads as a picture.
 *
 * Both are pure `transform`, both are written as custom properties by one
 * listener each, and neither is readable by anything -- these are two coloured
 * blurs behind text that is legible without them. Reduced motion attaches
 * nothing, `--drift-x` and `--scroll` stay at their `0` fallbacks, and the
 * washes sit exactly where the static page puts them.
 *
 * `overflow-hidden` lives on the section in `page.tsx`, and it has to: the
 * washes are wider than the column and a drifting blur that can reach the
 * window edge is a horizontal scrollbar on a phone.
 */
export function HeroField() {
  const host = useRef<HTMLDivElement>(null);
  useCursorDrift(host);
  useScrollDrift(host);

  return (
    <div
      ref={host}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
    >
      <span
        className="absolute inset-x-0 -top-[260px] h-[620px] rounded-[50%]"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in oklab, var(--rail) 15%, transparent), transparent)",
          transform:
            "translate3d(calc(var(--drift-x, 0) * -30px), calc(var(--drift-y, 0) * -30px + var(--scroll, 0) * 0.15px), 0)",
        }}
      />
      <span
        className="absolute inset-x-0 top-[240px] h-[560px] rounded-[50%]"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in oklab, var(--action) 22%, transparent), transparent)",
          transform:
            "translate3d(calc(var(--drift-x, 0) * 34px), calc(var(--drift-y, 0) * 34px + var(--scroll, 0) * -0.08px), 0)",
        }}
      />
    </div>
  );
}
