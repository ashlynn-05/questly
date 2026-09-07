"use client";

import { useEffect, useRef } from "react";
import { Plate } from "./Plate";
import { INSTALL_HINT_DISMISSED_KEY, isIosSafari, isStandalone } from "@/lib/pwa";

/**
 * The guide that shows an iOS user where the install button is.
 *
 * A guide and not a prompt, deliberately. Android Chrome raises its own
 * install affordance in the omnibox once the manifest and the worker are in
 * place, and the Next 16 PWA guide recommends AGAINST intercepting
 * `beforeinstallprompt` to build a custom button -- that event does not exist
 * on iOS at all, so a custom button would be a button on the platform that
 * already had one and missing on the platform that needs it. So: nothing on
 * Android, and on iOS Safari this, once ever per browser.
 *
 * A native `<dialog>`, not a div with a z-index. `showModal()` brings the
 * focus trap, the inert background, the backdrop element and Escape-to-close
 * with it -- all four are things a hand-rolled modal gets wrong, and the
 * hand-rolled version is more code for a worse result.
 */
export function InstallHint() {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem(INSTALL_HINT_DISMISSED_KEY)) return;
    } catch {
      // Safari's "Block All Cookies", or a private-mode quirk. Not being able
      // to remember a dismissal is not a reason to withhold the guide; it only
      // means it comes back next visit.
    }

    const standalone = isStandalone(
      matchMedia("(display-mode: standalone)").matches,
      // Non-standard, iOS only, and typed as absent everywhere else.
      (navigator as Navigator & { standalone?: boolean }).standalone,
    );
    if (standalone) return;
    if (!isIosSafari(navigator.userAgent, navigator.maxTouchPoints)) return;

    dialog.current?.showModal();
  }, []);

  // One exit for every way out -- the button, Escape, a tap on the backdrop.
  // `close` fires for all three, so the dismissal is remembered once here
  // rather than three times at three call sites, one of which would drift.
  function remember() {
    try {
      localStorage.setItem(INSTALL_HINT_DISMISSED_KEY, "1");
    } catch {
      // Closed for this visit either way; it just comes back next time.
    }
  }

  return (
    <dialog
      ref={dialog}
      onClose={remember}
      // The backdrop is the dialog's own box outside its padding, so a click
      // that lands on the element itself -- rather than on anything inside it
      // -- is a click on the backdrop. iOS has no Escape key and the whole
      // point of a modal is that it is not a trap.
      onClick={(event) => {
        if (event.target === dialog.current) dialog.current?.close();
      }}
      aria-labelledby="install-hint-title"
      // `--ground`, not `--ground-raised`: this is a full-width sheet on a
      // phone, and every control inside it is measured against the page ground.
      // Centred by the margin, and pinned to a readable width rather than the
      // viewport's -- a dialog defaults to shrink-to-fit.
      // The backdrop itself is painted in globals.css, next to `::selection`
      // and the scrollbar: it is a surface the browser draws, not one this
      // component owns.
      className="m-auto w-[min(92vw,420px)] rounded-[6px] border border-hairline bg-ground p-6 text-text"
    >
      <p className="board text-[11px] text-accent">Add to home screen</p>

      <h2 id="install-hint-title" className="display mt-3 text-[28px] text-text">
        Keep Questly one tap away
      </h2>

      <p className="mt-3 text-[14px] leading-relaxed text-dim">
        Installed, it opens straight into a new quest with no address bar — and it is the only way
        iOS will let Questly notify you when your group matches.
      </p>

      {/* Two stops, numbered. Not the route line: `.rail-end` and `.node` paint
          themselves in `--ground` to mask the line, so a rail is only correct
          on the page ground -- and reproducing that inside a dialog is a
          fragile way to draw two steps. See the `--ground` note in globals.css. */}
      <ol className="mt-5 flex flex-col gap-3">
        <li className="flex items-start gap-3">
          <span className="num shrink-0 text-[13px] text-accent">01</span>
          <span className="text-[14px] leading-snug text-dim">
            Tap <span className="text-text">Share</span> in Safari&rsquo;s toolbar — the square with
            an arrow out of the top.
          </span>
        </li>
        <li className="flex items-start gap-3">
          <span className="num shrink-0 text-[13px] text-accent">02</span>
          <span className="text-[14px] leading-snug text-dim">
            Scroll down and choose <span className="text-text">Add to Home Screen</span>.
          </span>
        </li>
      </ol>

      <div className="mt-6">
        <Plate variant="action" label="Got it" center onClick={() => dialog.current?.close()} />
      </div>
    </dialog>
  );
}
