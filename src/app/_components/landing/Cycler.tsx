"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The headline, alternating between the design's two lines on the board flap.
 *
 * The comp states both words on one element (`data-words="Make a little
 * detour.|Plans? Questly."`) and swaps the text at the midpoint of the flip, so
 * the row leaves carrying one destination and lands carrying the other. That is
 * the whole trick, and it is why the swap happens at `FLIP / 2` rather than at
 * either end.
 *
 * THE ACCESSIBILITY SHAPE, because a cycling `<h1>` is a trap otherwise. Two
 * things are true at once here: SC 2.2.2 wants moving content stoppable, and a
 * heading whose accessible name changes every few seconds renames the page
 * under a screen reader. Both are answered the same way -- the `<h1>` carries
 * ONE fixed accessible name in an `sr-only` span, and everything that moves is
 * `aria-hidden`. Nothing announces, nothing re-announces, and the page has one
 * title for the life of the visit.
 *
 * Under `prefers-reduced-motion` the cycle never starts: the first line is
 * rendered and stays. Same for a tab in the background -- `document.hidden` is
 * checked on every tick rather than relying on a timer that a throttled tab may
 * or may not have run.
 */

/** Matches `board-flip` in globals.css. The swap lands at half of it. */
const FLIP = 620;
/** How long a line is readable before the board moves again. */
const HOLD = 4200;

export function Cycler({ lines }: { lines: [string, string] }) {
  const [index, setIndex] = useState(0);
  const [flipping, setFlipping] = useState(false);
  const host = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let swap = 0;
    let settle = 0;
    const beat = setInterval(() => {
      if (document.hidden) return;
      // Off the bottom of the window, the flap is a moment nobody is in the
      // room for.
      const box = host.current?.getBoundingClientRect();
      if (!box || box.bottom < 0 || box.top > innerHeight) return;

      setFlipping(true);
      swap = window.setTimeout(
        () => setIndex((i) => (i + 1) % lines.length),
        FLIP / 2,
      );
      settle = window.setTimeout(() => setFlipping(false), FLIP);
    }, HOLD);

    return () => {
      clearInterval(beat);
      clearTimeout(swap);
      clearTimeout(settle);
    };
  }, [lines.length]);

  return (
    <span ref={host} className="relative inline-block">
      {/* The one name this heading ever has. Both lines, so the accessible
          name says everything the visible one says over time. */}
      <span className="sr-only">{lines.join(" ")}</span>
      <span
        aria-hidden="true"
        // `.flap` is `animation: ... both`, so it always ends where it started:
        // removing the class cannot leave the text stranded mid-rotation.
        className={`inline-block ${flipping ? "flap" : ""}`}
      >
        {highlight(lines[index])}
      </span>
    </span>
  );
}

/**
 * The comp's `.hl` treatment: the last word of each line in `--accent`. Both
 * lines end on the word that matters -- "detour." and "Questly." -- so this is
 * the rule rather than a per-line exception table.
 */
function highlight(line: string) {
  const cut = line.trimEnd().lastIndexOf(" ");
  if (cut < 0) return <span className="text-accent">{line}</span>;
  return (
    <>
      {line.slice(0, cut + 1)}
      <span className="text-accent">{line.slice(cut + 1)}</span>
    </>
  );
}
