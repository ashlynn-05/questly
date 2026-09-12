"use client";

import { useRef } from "react";
import { LIT, UNLIT, useRailTick } from "./useRailTick";

/**
 * The three reasons, on a vertical route line that fills as you read down it.
 *
 * WHAT THIS IS NOT: the design's own version is a 1000px scrolljacked frame
 * with a sticky inner panel and a marker dot that slides between three fixed
 * offsets while the page under it does not move. That is 640px of stolen scroll
 * for three short paragraphs, and on a phone it is a section you cannot get out
 * of at the speed you flicked. The IDEA -- a marker moving down a line, one
 * reason lit at a time -- survives without the jack: the line fills with real
 * scroll, and each stop lights as it crosses the reading line.
 *
 * The rail is `lg:` only, like every other route line on this page. Below it
 * the reasons are three stacked paragraphs, which is what they are.
 */

export type Reason = { mark: string; title: string; body: string };

export function ReasonsRail({ reasons }: { reasons: Reason[] }) {
  const list = useRef<HTMLOListElement>(null);
  const { lit } = useRailTick(list, reasons.length);

  return (
    <ol
      ref={list}
      className="relative m-0 flex list-none flex-col gap-10 p-0 lg:mx-auto lg:max-w-[1100px] lg:pl-[88px]"
    >
      {reasons.map((reason, i) => (
        <li
          key={reason.title}
          className="relative grid items-center gap-x-11 gap-y-2 lg:grid-cols-[0.95fr_1.05fr]"
        >
          {/* The line, one segment per stop, and the LAST stop draws none --
              so it ends at the final roundel's centre rather than at the
              container edge. That is the rule `RailEnd` exists to enforce, on
              a ground `RailEnd` cannot mask.

              Segments rather than one element measured end to end, because the
              three rows are different heights and no offset from the container
              edge lands on the last dot. Each is drawn twice: the unlit track,
              and the lit line clipped over it. Clip and not height, because a
              line that fills by growing reflows the column beside it. */}
          {i < reasons.length - 1 ? (
            <>
              <span
                aria-hidden="true"
                className="absolute top-[16px] -bottom-10 -left-[63px] hidden w-[2px] bg-rail lg:block"
              />
              <span
                aria-hidden="true"
                className="absolute top-[16px] -bottom-10 -left-[63px] hidden w-[2px] bg-action transition-[clip-path] duration-500 lg:block"
                style={{ clipPath: `inset(0 0 ${i < lit - 1 ? 0 : 100}% 0)` }}
              />
            </>
          ) : null}
          <span
            data-stop
            aria-hidden="true"
            className="absolute top-[10px] -left-[68px] hidden size-[12px] rounded-full border-2 transition-[background-color,border-color,box-shadow] duration-300 lg:block"
            style={i < lit ? LIT : UNLIT}
          />
          <div>
            <p className="board m-0 mb-[10px] text-[10px] text-accent">
              {reason.mark}
            </p>
            {/* The design gradient-clips this title from #ffd000 to #fdf8e1.
                Both are cream on the day ground and the text vanishes, so it
                runs from `--accent` to `--text`, which swaps with the mode. */}
            <p
              // Windows High Contrast paints its own colours and a clipped
              // gradient has none to paint, so the fill is forced back on. `!`
              // because these beat an inline style only as `!important`.
              className="display m-0 text-[clamp(26px,3.4vw,38px)] forced-colors:!bg-none forced-colors:!text-text"
              style={{
                backgroundImage:
                  "linear-gradient(100deg, var(--accent) 0%, var(--text) 100%)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              {reason.title}
            </p>
          </div>
          <p className="m-0 max-w-[48ch] text-[15px] leading-[1.6] text-text">
            {reason.body}
          </p>
        </li>
      ))}
    </ol>
  );
}
