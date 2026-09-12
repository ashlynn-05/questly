"use client";

import { motion, useReducedMotion } from "motion/react";
import { ThemeImage } from "@/components/questly/ThemeImage";

/**
 * The venue row.
 *
 * READ THE EYEBROW BEFORE CHANGING THE COPY. PRODUCT.md forbids customer logos,
 * "trusted by", and any named venue presented as a real partner, and this row
 * is the exact shape those claims arrive in. It is allowed here only because it
 * says what it is: venues Questly WOULD launch with. Nothing on the page claims
 * a relationship, a booking, or a signature. Any edit that turns "we would
 * launch with" into "our partners" is the forbidden version.
 *
 * The loop runs on `motion` rather than a keyframe because `globals.css` is not
 * being extended for one marquee -- and because `useReducedMotion` stops it
 * dead, where a CSS animation would need its own media-query block.
 */

const VENUES = [
  { name: "Yo-Chi", slug: "yochi", w: 111, h: 30 },
  { name: "Marion", slug: "marion", w: 105, h: 28 },
  { name: "The Meat & Wine Co", slug: "meatwine", w: 220, h: 20 },
  { name: "Hazel", slug: "hazel", w: 71, h: 36 },
  { name: "Brick Lane", slug: "bricklane", w: 139, h: 26 },
];

const PLATE =
  "flex min-h-[72px] w-[196px] flex-none items-center justify-center rounded-[6px] border border-hairline px-4";

export function Venues() {
  const reduceMotion = useReducedMotion();

  return (
    <div className="overflow-hidden">
      <motion.div
        className="flex w-max gap-3"
        // From -50% to 0: the track holds the list twice, so sliding by exactly
        // half of it returns to an identical frame and the seam never shows.
        animate={reduceMotion !== false ? undefined : { x: ["-50%", "0%"] }}
        transition={{ duration: 34, ease: "linear", repeat: Infinity }}
      >
        {[0, 1].map((copy) =>
          VENUES.map((venue) => (
            <span
              key={`${copy}-${venue.slug}`}
              className={PLATE}
              // The second pass is the loop's tail, not five more venues.
              aria-hidden={copy === 1 ? "true" : undefined}
            >
              <ThemeImage
                night={`/brand/${venue.slug}-night.png`}
                day={`/brand/${venue.slug}-day.png`}
                alt={venue.name}
                width={venue.w}
                height={venue.h}
                className="h-auto max-w-full object-contain"
              />
            </span>
          )),
        )}
      </motion.div>
    </div>
  );
}
