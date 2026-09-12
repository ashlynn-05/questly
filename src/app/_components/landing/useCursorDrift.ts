"use client";

import { useEffect, type RefObject } from "react";

/**
 * The design's `data-cursor` parallax, as two CSS custom properties.
 *
 * The comp's numbers exactly: `--drift-x` is the pointer's distance from the
 * centre of the window as a fraction, `-0.5` at the left edge and `0.5` at the
 * right, and `--drift-y` is the same down the page. An element multiplies them
 * by its own strength -- the comp uses -30 and 34 on the hero washes and
 * -40/-22/22/40 on the fan cards -- and composes the result into whatever
 * transform it already has.
 *
 * ONE LISTENER, TWO PROPERTIES, AND NO REACT STATE. Six elements each holding a
 * scroll- or pointer-linked value is six subscriptions and six re-renders per
 * frame; a custom property set once on a host is one write that the compositor
 * picks up for every descendant. It is also why nothing here returns a value:
 * consumers read the properties in CSS, not in JavaScript.
 *
 * `(pointer: fine)` GUARDS IT ENTIRELY. A phone has no cursor to follow, and
 * the product is used on a phone -- so on a touch screen this attaches nothing
 * and the elements keep their resting transforms. Reduced motion is the same
 * story, stated the same way as everywhere else on this page: the settled state
 * is what you get.
 */
export function useCursorDrift(host: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    if (!matchMedia("(pointer: fine)").matches) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    let x = 0;
    let y = 0;

    function paint() {
      frame = 0;
      host.current?.style.setProperty("--drift-x", x.toFixed(4));
      host.current?.style.setProperty("--drift-y", y.toFixed(4));
    }
    function onMove(event: PointerEvent) {
      x = event.clientX / innerWidth - 0.5;
      y = event.clientY / innerHeight - 0.5;
      // One write per frame. `pointermove` fires per input sample, which on a
      // 1000Hz mouse is a lot of style invalidations for one transform.
      frame ||= requestAnimationFrame(paint);
    }

    addEventListener("pointermove", onMove, { passive: true });
    return () => {
      removeEventListener("pointermove", onMove);
      cancelAnimationFrame(frame);
    };
  }, [host]);
}

/**
 * The scroll companion, on the same shape: `--scroll` is how far the host has
 * travelled past the top of the window, in pixels, clamped to its own height so
 * a wash can never drift out of the section it belongs to.
 */
export function useScrollDrift(host: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    function paint() {
      frame = 0;
      const node = host.current;
      if (!node) return;
      const box = node.getBoundingClientRect();
      const travelled = Math.min(Math.max(-box.top, 0), box.height);
      node.style.setProperty("--scroll", `${travelled.toFixed(1)}`);
    }
    function schedule() {
      frame ||= requestAnimationFrame(paint);
    }

    addEventListener("scroll", schedule, { passive: true });
    addEventListener("resize", schedule);
    schedule();
    return () => {
      removeEventListener("scroll", schedule);
      removeEventListener("resize", schedule);
      cancelAnimationFrame(frame);
    };
  }, [host]);
}
