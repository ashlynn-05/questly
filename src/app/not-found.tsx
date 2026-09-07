import { Plate } from "@/components/questly/Plate";
import { ThemeToggle } from "@/components/questly/theme";

/**
 * The 404. Before this file existed, a mistyped room code -- the single most
 * likely wrong URL in a product whose links are pasted into group chats -- fell
 * through to Next's built-in page: unstyled, off-palette, and, per the Next 16
 * file-conventions guide, following the operating system's colour scheme rather
 * than this app's `data-theme`. A visitor in light mode could land on a black
 * screen carrying none of the product's language and no way back.
 *
 * `not-found.tsx` renders INSIDE the root layout, so it inherits `globals.css`,
 * the font and the theme script, and the toggle keeps working here like it does
 * everywhere else. (`global-not-found.js` bypasses the layout and would have to
 * re-import all of that; it is only needed for multiple root layouts, which
 * this app does not have.)
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-[520px] flex-1 flex-col justify-center gap-6 bg-ground px-5 py-10">
      <div className="flex items-start justify-between gap-3">
        <p className="board text-[11px] text-accent">Questly</p>
        <ThemeToggle />
      </div>

      {/* Named for what went wrong, not for the status code: "404" tells a
          person nothing they can act on. */}
      <h1 className="display text-[38px] text-text">This stop is not on the line</h1>

      <p className="text-[15px] leading-relaxed text-dim">
        The link may have a typo in it, or the room it pointed at has been closed. A room is only
        ever reached by its own link, so if a friend sent you one, the message is the place to
        check — retyping the code by hand is what usually lands here.
      </p>

      <div className="flex flex-col gap-3">
        <Plate variant="action" href="/start" label="Start a quest" center />
        <Plate variant="ghost" href="/" label="Back to the front" center />
      </div>
    </main>
  );
}
