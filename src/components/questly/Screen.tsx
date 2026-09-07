import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeToggle } from "./theme";
import { AccountBadge } from "./AccountBadge";

/**
 * The frame every screen in this product sits in.
 *
 * WHAT THIS REPLACED, because the numbers are the argument: eight routes had
 * hand-written shells between them carrying four column widths (420 / 460 /
 * 560), three horizontal paddings, four body gaps, two vertical alignments, two
 * different words in the left slot, eleven copies of the header row and four
 * copies of the loading screen. Nothing chose those differences -- they are
 * what happens when a shell is retyped per route. The visible cost was that the
 * two header roundels landed in a different place on almost every screen: on
 * `/sign-in` the whole column was centred, so the colour switch sat halfway
 * down the page; one route later it was at the top.
 *
 * WHY A FIXED HEADER BAND RATHER THAN A CENTRED COLUMN. `globals.css` states
 * the design as Melbourne wayfinding, and the one thing a transit network is
 * strict about is that the sign is in the same place at every stop -- you look
 * up, and it is there. So the header is a band of a fixed height at the top of
 * the frame on every route, and the content starts underneath it. Six routes
 * used to centre their whole column, sign included, which is why the colour
 * switch sat halfway down `/sign-in` and at the top of the screen after it.
 *
 * WHY IT IS NOT STICKY, which is the obvious next move: `/room` is a swipe
 * deck, and a permanently pinned 76px of chrome is 76px the card does not get
 * on a phone. The defect worth fixing was the header moving BETWEEN routes, and
 * a static band of a fixed height fixes exactly that. Sticky costs the one
 * screen the product is actually used on.
 *
 * WHY THE LEFT SLOT IS THE PRODUCT NAME AND NOT THE SCREEN NAME. A station sign
 * naming the station is the tempting version, and it is wrong here: every
 * screen already opens with an `<h1>` saying where you are, so a per-route
 * label in the header would be the same sentence twice. The wordmark is the
 * network, constant, and it is the way back to the top of it.
 */

type Props = {
  children: ReactNode;
  /**
   * Drop the body's horizontal padding. `/room` only: the deck is a full-bleed
   * card surface and its own sections carry the padding, screen by screen. The
   * header keeps its padding either way, so the roundels stay on the same
   * vertical line as everywhere else.
   */
  bleed?: boolean;
  /**
   * The account roundel. On by default -- including for a signed-out visitor,
   * where it is a way in rather than a badge with nothing behind it. Off on
   * `/sign-in` and `/sign-up`, where a "Sign in" control beside a sign-in form
   * is the same offer twice.
   */
  badge?: boolean;
};

export function Screen({ children, bleed = false, badge = true }: Props) {
  return (
    <main className="mx-auto flex w-full max-w-[460px] flex-1 flex-col bg-ground">
      {/* The band. `h-[76px]` is the 44px roundel plus 16px of air above and
          below -- a real height rather than padding, so it cannot drift when a
          route puts something taller in the left slot. The wordmark is on every
          route without exception, including `/`: it is the one fixed point, and
          a header that drops it on one screen is the drift this component
          exists to end. */}
      <header className="flex h-[76px] shrink-0 items-center justify-between gap-3 px-5">
        <Link
          href="/"
          // The 44px target floor this product holds everywhere. The label is
          // 11px, so the padding and min-height are what make it tappable, not
          // the word.
          className="board flex min-h-[44px] items-center px-1 text-[11px] text-accent"
        >
          Questly
        </Link>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          {badge ? <AccountBadge /> : null}
        </div>
      </header>

      {/* Centred in whatever height is left below the band, on every route
          without exception. The band does not move either way -- it is a
          sibling of this column, not part of what centres -- so the sign stays
          put while the content composes itself in the space underneath.

          Safe on a screen that overflows, which is the thing to check before
          copying this: `main` is `flex-1` inside a `min-h-full` body, and a
          flex item's `min-height: auto` floors it at its content, so a long
          screen grows rather than centring and clipping its own top. There is
          only free space to distribute when the content is genuinely shorter
          than the viewport. */}
      <div className={`flex flex-1 flex-col justify-center gap-8 pt-2 pb-10 ${bleed ? "" : "px-5"}`}>
        {children}
      </div>
    </main>
  );
}

/**
 * The screen while it is still asking.
 *
 * Deliberately NOT the full frame with an empty body: four routes had their own
 * copy of this, and every one of them drew the header first. A header whose
 * account roundel resolves a beat after the page does is a control that appears
 * under the thumb after you have decided where to tap. This shows the frame's
 * ground and one line, and the header arrives with the screen it belongs to.
 *
 * `label` is per route because the wait means different things: `/room` is
 * finding a room that may not exist, which is worth naming.
 */
export function ScreenPending({ label = "Loading…" }: { label?: string }) {
  return (
    <main className="mx-auto flex w-full max-w-[460px] flex-1 items-center justify-center bg-ground">
      <p className="board text-[11px] text-accent">{label}</p>
    </main>
  );
}
