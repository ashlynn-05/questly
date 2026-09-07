"use client";

import { useCallback, useRef, useState } from "react";

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
 * The in-flight guard is a ref, not `disabled`: disabling the button that
 * currently HAS focus hands focus straight back to <body>, which is the exact
 * defect this exists to avoid. It only needs to stop a second call, not to
 * re-render.
 *
 * `useCallback` with no deps on both ref callbacks is what makes them safe: a
 * ref callback recreated each render is detached and re-attached on every
 * render, which would drag focus back here every time the roster ticked.
 */
export function ConfirmButton({
  label,
  confirmLabel,
  cancelLabel,
  onConfirm,
  className = "",
}: {
  label: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => Promise<"trigger" | "gone">;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  const restore = useRef(false);
  const inFlight = useRef(false);

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
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      if ((await onConfirm()) === "trigger") disarm();
    } finally {
      inFlight.current = false;
    }
  }

  if (armed) {
    return (
      <span className="flex flex-wrap items-center gap-x-3">
        <button
          type="button"
          ref={focusOnMount}
          onClick={() => void go()}
          className="board min-h-[44px] px-3 text-[11px] text-danger underline underline-offset-4"
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          onClick={disarm}
          className="board min-h-[44px] px-3 text-[11px] text-accent underline underline-offset-4"
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
      className={`board min-h-[44px] px-3 text-[11px] text-accent underline underline-offset-4 ${className}`}
    >
      {label}
    </button>
  );
}
