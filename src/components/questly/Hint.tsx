"use client";

import { useId, useRef } from "react";
import { HELP, type HelpTopic } from "@/lib/help";
import { Plate } from "./Plate";
import { Question } from "./icons";

/**
 * A question mark that answers itself.
 *
 * `src/lib/help.ts` says what this is for: the explanations on `/settings` were
 * on screen permanently at a size that asked to be skipped, and this is where
 * they went. One of these sits beside each thing that needed explaining, and
 * the sentences arrive when they are asked for.
 *
 * WHY A ROUNDEL. This product's one drawn primitive is the roundel -- `.node`
 * draws stops on the route line, the colour switch and the account badge are
 * both roundels in the header. A hollow one means "open, not settled", which is
 * what `.node[data-state="open"]` already says on the line and is exactly what
 * a question is. It is 24px rather than the header's 44px because a help
 * trigger is subordinate to the control it explains; the BUTTON is still 44px,
 * which is the target floor this product holds everywhere. The negative margin
 * gives the target back its overlap so a 44px box does not push an 11px label
 * row to 44px tall -- the overlap is over text, which is not a target.
 *
 * WHY `<dialog>` AND NOT A HAND-ROLLED MODAL, which is what `MenuRoundel` next
 * door does for its menu. `showModal()` is the platform giving away, for free
 * and correctly, every part of this that is easy to get wrong: focus moved in,
 * focus trapped while open, the rest of the page inert, Escape closing, and
 * focus restored to this button on close. A menu has none of that available and
 * has to implement the WAI-ARIA pattern by hand, which is why `src/lib/menu.ts`
 * exists. A modal does, so there is no reason to write it again and no pure
 * function here worth testing -- the part of this feature that can be wrong is
 * the copy, and `help.test.ts` is where that is checked.
 *
 * The surface reuses `MenuRoundel`'s measured pairings rather than claiming new
 * ones: `--ground` fill with a `--text-dim` border, because `--text-dim` and
 * `--accent` are measured against `--ground` (5.26:1 and 5.68:1 in dark, 6.21:1
 * and 9.57:1 in light) and against `--ground-raised` they are numbers nobody in
 * this repository has computed.
 */
export function Hint({ topic }: { topic: HelpTopic }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const { title, body } = HELP[topic];

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        // The visible glyph is a question mark, which names no subject. The
        // accessible name has to say WHICH thing is being explained, because a
        // screen reader hears four of these on this screen in a row.
        aria-label={`About ${title}`}
        onClick={() => dialog.current?.showModal()}
        className="-my-2 flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center"
      >
        <span className="flex size-[24px] items-center justify-center rounded-full border border-dim text-accent">
          <Question className="size-[15px]" />
        </span>
      </button>

      <dialog
        ref={dialog}
        aria-labelledby={id}
        // The backdrop is a child of the dialog for hit-testing purposes, so a
        // click on it arrives here with the dialog itself as the target. The
        // check is what separates that from a click on the text inside.
        onClick={(event) => {
          if (event.target === dialog.current) dialog.current.close();
        }}
        // `m-auto` is load-bearing, not a tidy-up: the UA stylesheet centres an
        // open modal dialog with `margin: auto`, and Tailwind's preflight resets
        // `margin: 0` on every element, so without a class to win that cascade
        // the dialog pins itself to the top-left corner of the viewport.
        className="m-auto max-h-[80vh] w-[calc(100vw-40px)] max-w-[380px] overflow-y-auto rounded-[6px] border border-dim bg-ground p-5 text-text"
        style={{ boxShadow: "var(--shadow)" }}
      >
        <h2 id={id} className="board text-[11px] text-accent">
          {title}
        </h2>
        {/* 15px, the product's reading size. The whole point of moving this
            copy was that 12px is where text goes to be ignored. */}
        {body.map((paragraph) => (
          <p key={paragraph} className="mt-3 text-[15px] leading-snug text-text">
            {paragraph}
          </p>
        ))}
        {/* Focused by `showModal()` because it is the first focusable thing in
            here, which is the right landing place: the dialog says one thing
            and the only action is to have read it. */}
        <Plate
          variant="action"
          center
          className="mt-5"
          label="Got it"
          onClick={() => dialog.current?.close()}
        />
      </dialog>
    </>
  );
}
