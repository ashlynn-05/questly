"use client";

import { useCallback, useRef, useState } from "react";
import { useInFlight } from "@/hooks/useInFlight";

/**
 * A socially loaded action that asks once, and never loses focus on the way.
 *
 * Three things in this product cannot be undone from inside the app: taking
 * somebody out of a room, leaving one yourself, and doing either of those from
 * the deck screen while the rest of the room waits. Each is a two-step, and
 * each step REPLACES the control that was just pressed -- so focus falls to
 * <body> and a keyboard user Tabs from the top of the document, on the one
 * class of action where that matters most. This component owns both halves of
 * that movement: the confirm button takes focus as it mounts, and cancelling
 * -- or a refusal that leaves this control on screen -- puts focus back on the
 * trigger.
 *
 * `onConfirm` says where focus should end up, because only the caller knows:
 *
 *   "trigger" -- the action did not happen and this control is still here, so
 *                focus returns to the button the user started from.
 *   "gone"    -- the caller has already put focus somewhere real (the room's
 *                heading, a new screen), so this component leaves it alone.
 *
 * The in-flight guard is `useInFlight`, which is a ref rather than `disabled`
 * for the reason this component exists: disabling the button that currently HAS
 * focus hands focus straight back to <body>.
 *
 * `useCallback` with no deps on both ref callbacks is what makes them safe: a
 * ref callback recreated each render is detached and re-attached on every
 * render, which would drag focus back here every time the roster ticked.
 */
type Variant = "link" | "pill";

/**
 * How the two states are drawn. The label, the target and the two-step
 * behaviour are identical either way -- only the affordance differs.
 *
 * "link" is the original and stays the default, because it is what seven other
 * call sites are laid out around: inside plates, in prose, and under headings
 * where a bordered control would read as a second panel.
 *
 * "pill" borrows `Chip`'s vocabulary rather than inventing one. Same 5px
 * radius, same `border-dim` at rest -- a token this project has already
 * measured at 5.26:1 on night and 6.21:1 on day, where `--hairline` came in at
 * 1.44:1 and was rejected as invisible. The border IS the affordance here, so
 * the underline goes: an underline plus a box is two ways of saying the same
 * thing, and the box is the one that reads as a control rather than as a
 * sentence somebody linked.
 *
 * `face` carries no border COLOUR, only the width. Each of the three states
 * names its own, because two border-colour utilities on one element are
 * settled by the order Tailwind emits them rather than the order they are
 * written, and a hover that sometimes loses is worse than none.
 */
function face(variant: Variant): string {
  // The link face is stated whole rather than shared with the pill: it is what
  // seven call sites are already positioned against, down to a `-ml-3` on two
  // of them that cancels this exact padding, and a button that becomes a flex
  // box stops being inline where those sites put it.
  return variant === "pill"
    ? "board inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[5px] border px-4 text-[11px] transition-colors"
    : "board min-h-[44px] px-3 text-[11px] underline underline-offset-4";
}

export function ConfirmButton({
  label,
  confirmLabel,
  cancelLabel,
  onConfirm,
  variant = "link",
  className = "",
}: {
  label: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => Promise<"trigger" | "gone">;
  variant?: Variant;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  const restore = useRef(false);
  const run = useInFlight();

  const focusOnMount = useCallback((node: HTMLButtonElement | null) => {
    node?.focus();
  }, []);

  // Only fires when the flag is set, and clears it as it fires, so a later
  // re-render cannot pull focus back here on its own.
  const restoreTrigger = useCallback((node: HTMLButtonElement | null) => {
    if (node && restore.current) {
      restore.current = false;
      node.focus();
    }
  }, []);

  function disarm() {
    restore.current = true;
    setArmed(false);
  }

  async function go() {
    await run(async () => {
      if ((await onConfirm()) === "trigger") disarm();
    });
  }

  if (armed) {
    return (
      <span className={`flex flex-wrap items-center ${variant === "pill" ? "gap-2" : "gap-x-3"}`}>
        <button
          type="button"
          ref={focusOnMount}
          onClick={() => void go()}
          /* The destructive step wears its weight on the EDGE, not the
             letters. `--danger` as 11px text on `--ground-raised` measures
             4.32:1, under the 4.5:1 this project holds for small text; as a
             border it is over the 3:1 non-text floor with room to spare, and
             `--text` on that card reads at 8.76:1 night / 13.49:1 day.
             Hovering fills it, which is `Chip`'s own selected state: `--ground`
             on `--danger` is 5.03:1 and 6.30:1. */
          className={`${face(variant)} ${
            variant === "pill"
              ? "border-danger text-text hover:bg-danger hover:text-ground"
              : "text-danger"
          }`}
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          onClick={disarm}
          className={`${face(variant)} text-accent ${
            variant === "pill" ? "border-dim hover:border-accent" : ""
          }`}
        >
          {cancelLabel}
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      ref={restoreTrigger}
      onClick={() => setArmed(true)}
      className={`${face(variant)} text-accent ${
        variant === "pill" ? "border-dim hover:border-accent" : ""
      } ${className}`}
    >
      {label}
    </button>
  );
}
