import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeToggle } from "./theme";
import { ThemeImage } from "./ThemeImage";
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
  /**
   * The persistent left column, on the routes that have one.
   *
   * A slot rather than a flag, because the nav's live values come from the
   * route: `useQuery(api.rooms.get)` is called exactly once in this app, in the
   * room route, and threading a room through a shell that most routes do not
   * have a room for would be a provider around the whole product for three
   * strings. The route builds its own `<ShellNav>` and hands it down.
   *
   * Absent on `/`, `/sign-in`, `/sign-up`, `/join` and `/direction`: a front
   * door, two forms and a design reference are not places you navigate FROM.
   */
  nav?: ReactNode;
  /**
   * The horizontal stepper, on the two routes that are a journey.
   *
   * A slot for the same reason `nav` is one -- the stage comes from the route
   * -- but it is here rather than in `children` because of WHERE it belongs.
   * Passed down as content it sat inside the reading measure and inside the
   * body's vertical centring, so on a short screen the line floated in the
   * middle of the window with 200px of nothing above it. A progress bar that
   * moves down the page as the page gets shorter is not a bar you look up at.
   *
   * So it is pinned under the band, at the full width of the column beside the
   * nav rather than the measure's, on the same gutter as the content below so
   * the first roundel and the first heading share a left edge.
   */
  journey?: ReactNode;
};

export function Screen({
  children,
  bleed = false,
  badge = true,
  nav,
  journey,
}: Props) {
  return (
    /* WHY 1048px AND NOT THE WHOLE WINDOW. The brief's reference is What's On
       Melbourne, and the thing to copy from it is the restraint: measured off
       its own stylesheet, `.page-container` caps at 1000px and then 1048px with
       24px of side padding, and its nav band grows rather than the content
       running to the window edge. A transit network's signage does not get
       wider because the concourse did. So the desktop move here is a wider
       column and a taller band -- not a full-bleed dashboard, and not a phone
       centred in an empty field.

       Below `lg` (1024px) nothing changes: 460px is still the column, so the
       phone layout this product is actually used on is untouched.

       1256px is 236 + 940 + 80 -- the nav's column, the reading measure beside
       it, and that measure's own side padding. Stated as one number rather than
       as `nav + main` so a route WITHOUT a nav still centres its 940px in the
       same place as the routes with one, instead of drifting 118px left every
       time you leave a room.

       AND 1436px FROM `xl` UP, which is 236 + 1120 + 80. On a 1440 monitor the
       old cap left 184px of gutter on a shell that had already stopped growing,
       so a screen with two columns in it was running them at 446px each while
       300px of the window sat empty. The second number moves the same three
       parts, not the shell alone: raising this without raising the measure
       below would only widen the gutter INSIDE the shell.

       It stops at 1436 rather than following the window, because a measure that
       grows without limit is how a two-column screen becomes a 900px line of
       prose. A 1856px monitor keeps a real gutter on purpose. */
    <main className="mx-auto flex w-full max-w-[460px] flex-1 flex-col bg-ground lg:max-w-[1256px] xl:max-w-[1436px]">
      {/* The band. `h-[76px]` is the 44px roundel plus 16px of air above and
          below -- a real height rather than padding, so it cannot drift when a
          route puts something taller in the left slot. The wordmark is on every
          route without exception, including `/`: it is the one fixed point, and
          a header that drops it on one screen is the drift this component
          exists to end.

          `lg:h-[104px]` is the same sum with 30px of air instead of 16px. The
          roundel does not grow -- 44px is the target floor, not a phone
          concession.

          It stays 76px on a laptop rather than growing, and the hairline under
          it is why: once a nav column runs down the left, the band's job is to
          be the lid on it. A 104px lid over a 236px column reads as two
          unrelated bars, and the rule does the separating that height was doing
          before. The border is `lg:` only -- on a phone there is nothing below
          it to be separated from. */}
      <header className="flex h-[76px] shrink-0 items-center justify-between gap-3 px-5 lg:border-b lg:border-hairline lg:px-6">
        <Link
          href="/"
          // The 44px target floor this product holds everywhere. The mark is
          // 28px tall and grows to 34px on the wide band, so the padding and
          // min-height are what make it tappable, not the artwork.
          aria-label="Questly, home"
          className="flex min-h-[44px] items-center px-1"
        >
          {/* The drawn mark, not the word set in type. It is the same sign in
              the same place on every route, which is the whole point of this
              band -- and a sign is a picture of a name, not a caption. */}
          <ThemeImage
            night="/brand/questly-mark-night.png"
            day="/brand/questly-mark-day.png"
            alt="Questly"
            width={96}
            height={34}
            priority
            className="h-7 w-auto lg:h-[34px]"
          />
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
      {/* The nav and the body, side by side from `lg` and stacked-to-nothing
          below it (the nav renders nothing on a phone, so this is a one-column
          flex row there and costs nothing).

          `min-h-0` on the row: without it a tall body would floor the row at
          its content and the nav's own `flex-1` spacer would have nothing to
          push against. */}
      <div className="flex min-h-0 flex-1">
        {nav}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Nothing at all below `lg`, wrapper included: `Journey` is already
              hidden there, but an empty flex item still takes a gap, which is
              how the same band cost every room screen 32px of whitespace on a
              phone before it moved here. `px-10` and not the body's `px-5
              lg:px-10`, because this never renders on a phone and so has no
              phone padding to state. */}
          {journey ? (
            <div className="hidden lg:block lg:px-10 lg:pt-7">{journey}</div>
          ) : null}
          {/* Centred in whatever height is left, EXCEPT under a journey band.
              A band is a top anchor: with the content still centring beneath
              it, a short screen put the stepper at the top, the heading 200px
              lower, and a void between them that grew with the window. So a
              route with a band starts its content under the band and lets the
              space fall at the bottom. Only from `lg`, and only where there IS
              a band -- the phone has neither, and every other route keeps the
              centring exactly as it was. */}
          <div
            className={`flex min-w-0 flex-1 flex-col justify-center gap-8 pt-2 pb-10 ${
              journey ? "lg:justify-start lg:pt-8" : ""
            } ${bleed ? "" : "px-5 lg:px-10"}`}
          >
            {/* 940px is the design's own measure, and it is capped here rather
              than on `main` so the nav keeps its full 236px at every width
              instead of the two sharing a squeeze. 1120px from `xl` up is the
              other half of the wider shell above -- see the note on `main` for
              why both numbers move together. */}
            <div className="flex w-full flex-col gap-8 lg:mx-auto lg:max-w-[940px] xl:max-w-[1120px]">
              {children}
            </div>
          </div>
        </div>
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
 *
 * It carries `Screen`'s width verbatim, and has to: these two are the only
 * places the column is stated, and a pending frame one width and the resolved
 * screen another is a page that jumps sideways the moment the query lands.
 */
export function ScreenPending({ label = "Loading…" }: { label?: string }) {
  return (
    <main className="mx-auto flex w-full max-w-[460px] flex-1 items-center justify-center bg-ground lg:max-w-[1256px] xl:max-w-[1436px]">
      <p className="board text-[11px] text-accent">{label}</p>
    </main>
  );
}
