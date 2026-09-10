import { journeyModel } from "@/lib/shell/journey";
import type { Stop } from "./Concourse";

/**
 * The night as one line across the top of the screen.
 *
 * WHY HORIZONTAL AND NOT THE COLUMN. `Concourse` draws the same journey down
 * the left. This draws it across the top, which is what the desktop composition
 * asks for, and the difference is what the space beside it is then free to be:
 * a column costs 200px of every screen forever, a band costs one row once.
 *
 * WHY IT IS AN ORDERED LIST AND NOT NAVIGATION. Same argument `Concourse`
 * makes, and it has not changed: nothing here is reachable by pressing it. The
 * funnel is answered forwards and a room's status is a fact about the room. So
 * this is an `<ol>` with `aria-current="step"` on the stage you are standing on,
 * and the roundels stay decoration.
 *
 * WHERE IT MAY BE PUT. `.node` fills its roundel with `--ground` so the line
 * appears to pass behind it (see the note on `--ground` in `globals.css`). This
 * belongs on `Screen`'s own ground and nowhere raised. The joining lines are
 * NOT `.rail` -- that class is absolutely positioned down a column's left edge,
 * which is the wrong axis here -- so they are drawn inline in `--action`, the
 * same colour, at the same 3px.
 *
 * WHERE IT IS PUT. `Screen` places it, in the `journey` slot, pinned under the
 * header band at the full width of the column beside the nav. It used to be
 * passed down as content, which put it inside the reading measure and inside
 * the body's vertical centring -- so on a short screen it floated in the middle
 * of the window with a screenful of nothing above it.
 *
 * WHY IT IS HIDDEN BELOW `lg`. Mobile is unchanged; that is a decision, not an
 * oversight. `hidden` rather than a visual trick, so it leaves the
 * accessibility tree too.
 */
export function Journey({ at }: { at: Stop }) {
  const stages = journeyModel(at);

  return (
    <ol
      aria-label="Your night"
      className="m-0 hidden list-none items-start p-0 lg:flex"
      data-journey
    >
      {stages.map((stage) => (
        /* Only the stages that DRAW a line grow. The last one has none, and
           while it was growing too it held a fifth of the band empty: five
           equal shares meant the line stopped at 80% and the right-hand fifth
           of every screen was blank. Four growing shares put the roundels on
           0 / 25 / 50 / 75 / 100 of the full width, which is what makes the
           band span whatever it is given and re-space itself as that changes. */
        <li
          key={stage.id}
          className={`flex min-w-0 items-start ${stage.line ? "flex-1" : "shrink-0"}`}
          aria-current={stage.state === "live" ? "step" : undefined}
        >
          {/* The dot and its label share a zero-width column so the label can
              overhang without pushing the next stage along. Each stage's flex
              basis is therefore the LINE's width, which is what keeps five
              stages evenly spaced whatever their labels say. */}
          {/* The last stage hangs its roundel and label to the LEFT of the
              zero-width column instead of the right, because that column now
              sits on the band's right edge: left-aligned, the roundel and the
              word "PLAN" both stood outside the band, 19px past where the
              content below it ends. Hanging left puts them back inside, and
              the joining line -- which belongs to the stage before -- runs to
              the same point and passes behind the roundel, which is what
              `.node` fills itself with `--ground` for. */}
          <div
            className={`flex w-0 shrink-0 flex-col gap-3 ${
              stage.line ? "items-start" : "items-end"
            }`}
          >
            {/* `position: static` overrides `.node`'s absolute placement, which
                is written for a vertical rail. The class is reused rather than
                reimplemented so the three states stay one definition. */}
            <span
              aria-hidden="true"
              className="node !static !translate-x-0"
              data-state={stage.state}
            />
            {/* Apricot for where you are and for what is done, dim for what is
                ahead. Never colour alone: `aria-current` above carries the same
                fact, and the live roundel's ring and halo carry it visually. */}
            <span
              className={`board text-[10px] whitespace-nowrap ${
                stage.state === "open" ? "text-dim" : "text-accent"
              }`}
            >
              {stage.label}
            </span>
          </div>
          {stage.line ? (
            /* Drawn from the roundel's centre. 13px is half the 19px roundel
               (13px disc inside a 3px ring), and 5px puts the line on the
               vertical middle of it. */
            <span
              aria-hidden="true"
              className="mt-[8px] ml-[13px] h-[3px] flex-1 rounded-[2px] bg-action"
            />
          ) : null}
        </li>
      ))}
    </ol>
  );
}
