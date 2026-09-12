"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * The design's `data-reveal`: content rises 22px and fades in the first time it
 * crosses into view, once, and then stays.
 *
 * ORDER OF EVENTS IS THE WHOLE COMPONENT. The children are rendered VISIBLE and
 * the effect hides them; it is never written the other way round. A reveal
 * built the usual way -- start at `opacity: 0`, animate up -- is a page that
 * shows nothing at all if the observer never fires, and observers do not fire
 * in a background tab, in a print stylesheet, in a crawler, or in a browser
 * where the effect threw before it got there. Here the worst case costs an
 * animation, not the page.
 *
 * THE HIDING IS DONE ON THE ELEMENT, NOT THROUGH STATE. Setting state
 * synchronously inside an effect is a re-render of the subtree for something
 * that is purely presentational, and `react-hooks/set-state-in-effect` is right
 * to flag it. Two style writes on a ref say the same thing and cost nothing.
 *
 * `prefers-reduced-motion` returns before anything is hidden, which is the same
 * guarantee stated from the other end: reduced motion sees the finished page.
 * The 2.5s fallback covers an observer that is never going to fire.
 */
export function Reveal({
  delay = 0,
  className = "",
  children,
}: {
  /** Milliseconds after the element lands in view. Used to stagger a row. */
  delay?: number;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    el.style.opacity = "0";
    el.style.transform = "translateY(22px)";
    // Commit the hidden state BEFORE the transition exists, and the order of
    // these three statements is the whole trick.
    //
    // Reading a layout property flushes the style, which is what gives the
    // coming transition a start value. WITHOUT IT an element that is already in
    // view never animates: the observer's first callback lands in the same
    // frame the style was written, the browser goes visible-to-visible, and
    // there is no animation at all -- which is exactly how the first viewport
    // looked.
    //
    // And the transition is armed AFTER the flush, not before, or the hide
    // itself would animate: a transition declared in the same style change as
    // the value it covers runs on that change too, and the block would fade OUT
    // for 620ms before it faded in.
    void el.offsetHeight;
    el.style.transition =
      "opacity 620ms cubic-bezier(0.16, 1, 0.3, 1), transform 620ms cubic-bezier(0.16, 1, 0.3, 1)";
    el.style.transitionDelay = `${delay}ms`;

    function show() {
      if (!el) return;
      el.style.opacity = "1";
      el.style.transform = "none";
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        show();
        // Once. A section that re-hides itself on the way back up is a page
        // that flickers when you scroll to check something.
        observer.disconnect();
      },
      { rootMargin: "0px 0px -6% 0px", threshold: 0.12 },
    );
    observer.observe(el);
    const fallback = setTimeout(show, 2500);

    return () => {
      observer.disconnect();
      clearTimeout(fallback);
    };
  }, [delay]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
