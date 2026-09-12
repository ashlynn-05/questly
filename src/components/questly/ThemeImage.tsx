import Image from "next/image";

/**
 * One artwork with a night version and a day version, swapped by CSS.
 *
 * WHY BOTH ARE IN THE MARKUP rather than one `src` chosen in JavaScript. The
 * theme is resolved by an inline script before paint and lives on the root
 * element as `data-theme`; nothing exports the resolved value to React. A
 * component that read it in an effect would render the night logo first and
 * correct itself after hydration, which is a visible flash on the one element
 * at the top of the front door. CSS has the answer before React exists.
 *
 * THE THREE STATES, which is why this is not one `prefers-color-scheme` block.
 * The toggle sets `data-theme="light"`, `data-theme="dark"`, or nothing at all
 * for Auto. So day is "the OS says light AND the user has not pinned dark", OR
 * "the user pinned light" -- the same pair of guards `globals.css` uses for the
 * day palette, written here for the same reason.
 *
 * `precedence` is React 19's stylesheet dedupe: this component renders eleven
 * times on the page and the rules are emitted once.
 */

const CSS = `
.q-day{display:none}
@media (prefers-color-scheme: light){
  :root:not([data-theme="dark"]) .q-night{display:none}
  :root:not([data-theme="dark"]) .q-day{display:block}
}
:root[data-theme="light"] .q-night{display:none}
:root[data-theme="light"] .q-day{display:block}
`;

export function ThemeImage({
  night,
  day,
  alt,
  width,
  height,
  className = "",
  priority = false,
}: {
  night: string;
  day: string;
  /** Carried by both copies. Only one is ever displayed, so only one is read. */
  alt: string;
  width: number;
  height: number;
  className?: string;
  priority?: boolean;
}) {
  return (
    <>
      <style href="questly-theme-image" precedence="default">
        {CSS}
      </style>
      <Image
        src={night}
        alt={alt}
        width={width}
        height={height}
        priority={priority}
        className={`q-night ${className}`}
      />
      <Image
        src={day}
        alt={alt}
        width={width}
        height={height}
        priority={priority}
        className={`q-day ${className}`}
      />
    </>
  );
}
