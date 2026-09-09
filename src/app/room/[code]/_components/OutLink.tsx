import type { ReactNode } from "react";

/**
 * A control that leaves the app.
 *
 * Named for what it does rather than where it goes: it began as the maps links
 * alone, and the calendar link is the fifth caller and the first that is not a
 * map at all.
 *
 * NOT a `Plate` with `href`. That renders a Next `<Link>`, which has no `target`
 * and no `rel` -- it is for navigating WITHIN the app. Every caller here goes
 * somewhere else, and they open in their own tab so the room is still there
 * when the user comes back. `Booked.tsx` already carried a hand-rolled anchor
 * saying exactly that in a comment; this is that anchor, with the other
 * callers no longer able to forget half of it.
 *
 * What it owns is the part that is easy to drop on the third copy: the 44px
 * target WCAG 2.2 AA asks for, `rel="noreferrer"`, and the sr-only sentence
 * warning that a new tab is about to open -- because a tab appearing unannounced
 * is disorienting with a screen reader and merely rude without one.
 *
 * What it does NOT own is how it looks. `className` stays with the caller: the
 * booked screen's is the primary action on that screen and wears the orange
 * field, the deck's must not compete with "I'm in" and wears a hairline. A
 * `variant` prop here would be a second `Plate`, and one is enough.
 */
export function OutLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`flex min-h-[44px] items-center justify-center rounded-[6px] px-4 ${className}`}
    >
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
