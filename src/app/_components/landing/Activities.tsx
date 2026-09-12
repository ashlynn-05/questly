"use client";

import { useRef } from "react";
import { Reveal } from "./Reveal";
import { useRailTick } from "./useRailTick";

/**
 * The three kinds of night, with the selection travelling as you scroll.
 *
 * The design draws these three cards with the middle one filled orange and the
 * other two quiet, and leaves it there. That is a still frame of something the
 * product actually does -- the board proposing one option at a time -- so here
 * the fill moves: as the row crosses the reading line, the selected card steps
 * from the first to the third.
 *
 * It rides `useRailTick`, the same 60%-of-window line the two route lines use,
 * so everything on this page that responds to scroll responds at the same
 * moment.
 *
 * THE COLOUR IS DECORATION AND NOTHING ELSE. All three cards carry the same
 * words in the same order whichever one is filled; nothing is disclosed, and
 * the fill is never the only thing telling them apart. Reduced motion lands on
 * the settled state like everything else here, which is the third card -- the
 * row read to its end.
 */

export type Activity = { mark: string; title: string; body: string };

export function Activities({ activities }: { activities: Activity[] }) {
  const row = useRef<HTMLDivElement>(null);
  // Driven by the ROW's progress past the line, not by each card's own top --
  // which is the difference between working and not working on a desktop. From
  // `lg` the three cards are side by side and their tops are identical, so a
  // per-card count steps 0 to 3 in one frame and the fill never travels. The
  // row's own fill fraction is the same number on both layouts.
  const { drawnY } = useRailTick(row, activities.length);
  const selected = Math.min(
    Math.floor(drawnY * activities.length),
    activities.length - 1,
  );

  return (
    <div ref={row} className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      {/* `h-full` on BOTH the wrapper and the card. The grid stretches the
          wrapper to the tallest row on its own, but the card inside it is
          content-height -- which is why a two-line card sat short beside a
          three-line one and the three fills stopped lining up. */}
      {activities.map((activity, i) => (
        <Reveal key={activity.title} delay={i * 100} className="h-full">
          <div
            className={`flex h-full flex-col rounded-[6px] border p-[22px] transition-colors duration-500 ${
              i === selected
                ? "border-action-edge bg-action text-on-action"
                : "border-transparent bg-ground text-dim"
            }`}
          >
            <p
              className={`board m-0 mb-[10px] text-[10px] ${
                i === selected ? "text-on-action" : "text-accent"
              }`}
            >
              {activity.mark}
            </p>
            <p
              className={`display m-0 text-[20px] ${i === selected ? "" : "text-text"}`}
            >
              {activity.title}
            </p>
            <p className="m-0 mt-2 text-[13px] leading-[1.45]">
              {activity.body}
            </p>
          </div>
        </Reveal>
      ))}
    </div>
  );
}
