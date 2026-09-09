"use client";

import { useEffect, useRef } from "react";
import { Plate } from "./Plate";
import { usePush } from "./usePush";

/**
 * The invitation to turn notifications on.
 *
 * A SOFT ASK IN FRONT OF THE NATIVE ONE, not instead of it. Tapping "Turn them
 * on" opens the device's own permission dialog, from inside the tap, which is
 * the only way Safari will open it at all. This exists because the native
 * dialog can only ever be shown once: dismissing it is a permanent denial that
 * nothing in this app can undo, and Chrome's quiet UI throws away a prompt that
 * arrives before the user has expressed any interest. So the reversible
 * question comes first, and the irreversible one is spent on a yes.
 *
 * `usePush` owns every rule about when this may appear -- supported, keys
 * configured, somebody to file it under, not already on, not previously
 * dismissed, and on iOS only once the app is on the home screen. This component
 * owns the dialog and the words.
 *
 * A native `<dialog>`, not a div with a z-index, for the reasons `InstallHint`
 * gives at length: `showModal()` brings the focus trap, the inert background,
 * the backdrop element and Escape-to-close, and a hand-rolled modal is more
 * code for a worse result.
 */
export function PushHint({ seat = null }: { seat?: { code: string; sessionKey: string } | null }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const push = usePush(seat);

  // `push.ask` becomes true only once several server answers have landed, so
  // this cannot be a mount-only effect the way `InstallHint`'s is. It opens the
  // dialog once and never reopens it: `open` is the dialog's own state, so a
  // person who closed it does not get it back when an unrelated query settles.
  useEffect(() => {
    if (push.ask && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [push.ask]);

  async function turnOn() {
    // Inside the tap, deliberately: `enable` calls `requestPermission()` first
    // and Safari rejects that call outside a user gesture. Awaiting it here
    // keeps the dialog up while the native one is answered, so a denial has
    // somewhere to be reported.
    const ok = await push.enable();
    if (ok) dialog.current?.close();
  }

  return (
    <dialog
      ref={dialog}
      // One exit for every way out -- the button, Escape, a tap on the
      // backdrop -- so the "not now" is remembered once here rather than at
      // three call sites, one of which would drift.
      onClose={push.dismiss}
      // The backdrop is the dialog's own box outside its padding, so a click
      // that lands on the element itself is a click on the backdrop. iOS has no
      // Escape key and the whole point of a modal is that it is not a trap.
      onClick={(event) => {
        if (event.target === dialog.current) dialog.current?.close();
      }}
      aria-labelledby="push-hint-title"
      className="m-auto w-[min(92vw,420px)] rounded-[6px] border border-hairline bg-ground p-6 text-text"
    >
      <p className="board text-[11px] text-accent">Notifications</p>

      <h2 id="push-hint-title" className="display mt-3 text-[28px] text-text">
        Know the moment it happens
      </h2>

      <p className="mt-3 text-[14px] leading-relaxed text-dim">
        The moments worth knowing about happen on somebody else&rsquo;s phone — the room fills up,
        everyone lands on the same place, the plan gets written, the night is booked. We will tell
        you when they do, and never what anyone chose.
      </p>

      {/* The failure has to be visible from inside the dialog, because the
          dialog is modal: anything rendered behind it is inert and unread. A
          denial in particular needs saying here, since it is the one outcome
          no later tap can change. */}
      {push.error ? (
        <p role="alert" className="mt-4 text-[13px] leading-snug text-accent">
          {push.error}
        </p>
      ) : null}

      <div className="mt-6 flex flex-col gap-2">
        <Plate
          variant="action"
          center
          label={push.busy ? "Asking…" : "Turn them on"}
          onClick={() => void turnOn()}
        />
        {/* Not styled as a second action. Saying no here is free and is meant
            to look free -- the whole reason this dialog exists is that the
            native one's "no" is not. */}
        <button
          type="button"
          className="py-2 text-[13px] text-dim underline underline-offset-4"
          onClick={() => dialog.current?.close()}
        >
          Not now
        </button>
      </div>
    </dialog>
  );
}
