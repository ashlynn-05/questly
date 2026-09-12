"use client";

import { useRef } from "react";
import { LIT, UNLIT, useRailTick } from "./useRailTick";

/**
 * The six-stop journey, with the design's scroll behaviour: the route line
 * draws itself from the left as the band arrives, and each roundel fills when
 * it crosses 60% of the window.
 *
 * WHY THIS IS NOT `Rail`/`RailNode`. Those two primitives mask the line by
 * painting `--ground` over it, which works only while they sit on the page
 * ground. This page's ground is `--ground-deep`, so every roundel here is
 * written out with its fill stated -- 13px, a 3px `--action` ring, filled with
 * the page colour so the line reads as passing behind it.
 *
 * The whole thing decorates a list that is already readable as text, so nothing
 * here is announced and nothing here is required to have run.
 */

export type Stop = { mark: string; title: string; body: string };

export function RouteBand({ stops }: { stops: Stop[] }) {
  const band = useRef<HTMLOListElement>(null);
  const { lit, drawnX } = useRailTick(band, stops.length);

  return (
    <ol
      ref={band}
      aria-label="How a night gets planned"
      className="relative m-0 grid list-none grid-cols-1 gap-8 p-0 lg:grid-cols-6 lg:gap-6"
    >
      <span
        aria-hidden="true"
        className="absolute top-[6px] left-0 hidden h-[3px] rounded-[2px] lg:block"
        style={{
          // The sixth column's own width, less half a roundel: the line stops at
          // the terminus node's centre. `100% / 6` is NOT that width -- the five
          // 24px gaps come out of the track first, and leaving them in overshoots
          // by a whole gap.
          right: "calc((100% - 120px) / 6 - 6.5px)",
          background:
            "linear-gradient(90deg, var(--rail), var(--action) 45%, var(--accent))",
          clipPath: `inset(0 ${((1 - drawnX) * 100).toFixed(1)}% 0 0)`,
        }}
      />
      {stops.map((stop, i) => (
        <li key={stop.title} className="relative pt-[34px] pl-8 lg:pl-0">
          {/* The phone's line, one segment per stop so it ends at the last
              roundel. The rows are different heights, so no single offset from
              the container edge lands there. */}
          {i < stops.length - 1 ? (
            <span
              aria-hidden="true"
              className="absolute top-[6px] -bottom-8 left-[5px] w-[3px] rounded-[2px] bg-action lg:hidden"
            />
          ) : null}
          <span
            data-stop
            aria-hidden="true"
            className="absolute top-0 left-0 size-[13px] rounded-full border-[3px] transition-[background-color,border-color,box-shadow] duration-300"
            style={i < lit ? LIT : UNLIT}
          />
          <p className="board m-0 mb-2 text-[10px] text-accent">{stop.mark}</p>
          <p className="display m-0 text-[22px]">{stop.title}</p>
          <p className="m-0 mt-[6px] text-[12px] leading-[1.45] text-dim">
            {stop.body}
          </p>
        </li>
      ))}
    </ol>
  );
}
