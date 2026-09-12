"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * The design's scroll behaviour for a route line, as one number per rail plus a
 * count of the stops that have been passed.
 *
 * `innerHeight * 0.6` is the comp's own line: a stop lights when it crosses the
 * point where you are actually looking, not when it enters the window. The two
 * draw windows are its numbers too -- a horizontal rail fills over a fixed
 * 320px of scroll, a vertical one fills in proportion to its own height,
 * because a six-across band and a three-deep column are different distances.
 *
 * THE SETTLED STATE IS "EVERYTHING ON", not "everything off", and that is
 * load-bearing. Reduced motion returns it immediately, and so does a first
 * paint that never gets a scroll event. A rail that draws itself from zero on
 * arrival is a rail that stays at zero if the observer never runs -- the same
 * trap `Reveal` and `FlipOnView` are written around.
 */
export function useRailTick(ref: RefObject<HTMLElement | null>, stops: number) {
  const [state, setState] = useState({ lit: stops, drawnX: 1, drawnY: 1 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    function tick() {
      frame = 0;
      const node = ref.current;
      if (!node) return;
      const mid = innerHeight * 0.6;
      const box = node.getBoundingClientRect();

      let lit = 0;
      node.querySelectorAll("[data-stop]").forEach((dot) => {
        if (dot.getBoundingClientRect().top < mid) lit += 1;
      });

      setState({
        lit,
        drawnX: clamp((mid - box.top + 160) / 320),
        drawnY: clamp((mid - box.top) / Math.max(box.height, 1)),
      });
    }
    function schedule() {
      // One measurement per frame. `scroll` fires far more often than that and
      // every read here forces layout.
      frame ||= requestAnimationFrame(tick);
    }

    addEventListener("scroll", schedule, { passive: true });
    addEventListener("resize", schedule);
    schedule();
    return () => {
      removeEventListener("scroll", schedule);
      removeEventListener("resize", schedule);
      cancelAnimationFrame(frame);
    };
  }, [ref, stops]);

  return state;
}

function clamp(n: number) {
  return Math.min(1, Math.max(0, n));
}

/** The comp's lit stop: filled, ringed, and glowing. */
export const LIT = {
  borderColor: "var(--accent)",
  background: "var(--accent)",
  boxShadow: "0 0 0 5px color-mix(in srgb, var(--accent) 24%, transparent)",
} as const;

/** The comp's unlit stop: an open roundel on the page ground. */
export const UNLIT = {
  borderColor: "var(--action)",
  background: "var(--ground-deep)",
} as const;
