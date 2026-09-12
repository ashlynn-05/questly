"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Flips its contents once, when they first come into view, and then never
 * again.
 *
 * `board-flip` is already in `globals.css` -- it is the product's authored
 * moment, every phone's board flipping through its candidates and landing on
 * the same destination -- and this is that same flap on the front door. Not a
 * fade-and-rise reveal: a departure board has no crossfade, and a page whose
 * every section slides up is the generic default this design system was written
 * against.
 *
 * ORDER OF EVENTS MATTERS HERE. `.flap` is `animation: ... both`, so the class
 * alone runs it once and leaves the element where the last keyframe put it,
 * which is exactly where it started. That means the content is VISIBLE with the
 * class absent, visible during the delay, and visible afterwards -- there is no
 * state of this component in which text is hidden. A reveal built the usual way
 * (start at `opacity: 0`, animate up) is a page that shows nothing if the
 * observer never fires, and `prefers-reduced-motion` already shortens `.flap`
 * to 1ms rather than removing it.
 *
 * `threshold: 0.35` rather than 0: a board row half off the bottom of the
 * window flipping where you cannot read it has spent the moment for nothing.
 */
export function FlipOnView({
  delay = 0,
  className = "",
  children,
}: {
  /** Milliseconds after the element lands in view. Used to stagger board rows. */
  delay?: number;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [flipped, setFlipped] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setFlipped(true);
        // Once. The flap says "this has landed", and a thing that lands twice
        // has not landed.
        observer.disconnect();
      },
      { threshold: 0.35 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <span
      ref={ref}
      className={`inline-block ${flipped ? "flap " : ""}${className}`}
      style={flipped && delay ? { animationDelay: `${delay}ms` } : undefined}
    >
      {children}
    </span>
  );
}
