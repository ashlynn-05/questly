/**
 * One resolution order for the page's theme, in the two forms the app needs it.
 *
 * There are unavoidably two implementations: a pre-paint inline script (a
 * string, because it has to run before React exists or the wrong mode flashes)
 * and the toggle's own read (TypeScript). They kept drifting apart, and every
 * drift is the same bug -- the page in one mode with the switch claiming the
 * other. The last round fixed the valid cases and the empty case and left one:
 * `?theme=purple` with `"dark"` in the store. The script took `q` unvalidated,
 * so `m` became `"purple"`, failed the light/dark check, and set nothing -- the
 * page rendered from `prefers-color-scheme`, while the toggle skipped the
 * invalid URL value, read the store, and highlighted Night. On a light-
 * preference OS: Day mode, "Night" checked.
 *
 * So both forms live here, next to each other, and `theme.test.ts` runs the
 * actual script string against `resolveThemeMode` over the same case table. A
 * future drift fails a test instead of shipping.
 *
 * Deliberately not a React module: `layout.tsx` is a server component and this
 * is the only thing it wanted from the client-side toggle file.
 */

export type ThemeMode = "system" | "dark" | "light";

/** One key, named once, shared by the toggle and the pre-paint script. */
export const THEME_STORAGE_KEY = "questly-theme";

/**
 * `?theme=` wins, then the stored choice, then the OS. An invalid or absent
 * value at either level falls through to the next one -- it never suppresses
 * what is behind it, which is exactly the mistake the script used to make.
 */
export function resolveThemeMode(fromUrl: string | null, stored: string | null): ThemeMode {
  if (fromUrl === "light" || fromUrl === "dark") return fromUrl;
  if (stored === "light" || stored === "dark") return stored;
  return "system";
}

/**
 * What `--ground` actually resolves to in each mode, as literals.
 *
 * `--q-iris` and `--q-cornsilk` from `globals.css`. They are duplicated here
 * because their third consumer is a `<meta name="theme-color">`, and a meta
 * value is a string the browser reads out of the document -- there is no
 * `var()` to resolve. `theme.test.ts` asserts these against the stylesheet, so
 * a change to the palette fails a test instead of shipping a status bar in
 * last season's colour.
 */
export const GROUND_DARK = "#3b3686";
export const GROUND_LIGHT = "#fdf8e1";

/**
 * The colour the browser paints its own furniture with: the iOS status bar and
 * toolbar, Android's task switcher, a desktop PWA's title bar.
 *
 * This is a THIRD implementation of the same resolution, which is exactly the
 * drift this file exists to stop -- so it takes the already-resolved mode
 * rather than re-reading the URL and the store, and only "system" needs the OS
 * preference at all.
 */
export function themeColorFor(mode: ThemeMode, prefersLight: boolean): string {
  if (mode === "light") return GROUND_LIGHT;
  if (mode === "dark") return GROUND_DARK;
  return prefersLight ? GROUND_LIGHT : GROUND_DARK;
}

/**
 * The same order, as an inline pre-paint script. Runs before paint so a stored
 * choice never flashes the other mode first; inlined deliberately, because a
 * deferred script is a visible repaint.
 *
 * Wrapped in an IIFE, as the Next docs' own example is, so `q` and `m` are not
 * two globals on every page in the app. "system" is the absence of the
 * attribute, which is why there is no `else` -- the stylesheet's
 * `prefers-color-scheme` rules are the fallback.
 *
 * It also writes the `theme-color` meta, and that is not a separate concern
 * bolted on: with no meta at all, iOS Safari tints its bars by SAMPLING the
 * page, and what it samples is the `<body>` background -- `--ground-deep`,
 * which is not the ground any screen in this app actually paints. That is the
 * two dark bands above and below a Questly page on a phone.
 *
 * `viewport.themeColor` in the layout would be the obvious way to emit this and
 * is the wrong one HERE: Next writes those as `prefers-color-scheme` media
 * queries, which track the OS and cannot see `data-theme`. A user on a dark
 * phone who picks Day would get a cornsilk page under an iris status bar --
 * the same mismatch, in the other direction. So the meta is written by the code
 * that already knows the answer, and updated by `ThemeToggle` when it changes.
 *
 * The attribute is set BEFORE any of the meta work: if a browser without
 * `matchMedia` (or with the document locked down) throws, the mode is already
 * applied and only the bar tint is lost.
 */
export const themeScript = `(function(){try{var q=new URLSearchParams(location.search).get("theme");var m=(q==="light"||q==="dark")?q:localStorage.getItem("${THEME_STORAGE_KEY}");if(m==="light"||m==="dark")document.documentElement.setAttribute("data-theme",m);var l=m==="light"||(m!=="dark"&&matchMedia("(prefers-color-scheme: light)").matches);var e=document.querySelector('meta[name="theme-color"]');if(!e){e=document.createElement("meta");e.setAttribute("name","theme-color");document.head.appendChild(e)}e.setAttribute("content",l?"${GROUND_LIGHT}":"${GROUND_DARK}")}catch(x){}})()`;

/**
 * The browser-side half of the same thing, for when the mode changes after
 * paint. Creates the meta if the pre-paint script never got to run.
 *
 * Separate from the script only because one of them has to be a string; both
 * resolve through `themeColorFor`, so they cannot disagree about a mode.
 */
export function applyThemeColor(mode: ThemeMode): void {
  try {
    const prefersLight = matchMedia("(prefers-color-scheme: light)").matches;
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "theme-color");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", themeColorFor(mode, prefersLight));
  } catch {
    // Nothing to recover: the page keeps whatever tint it already had. The
    // mode itself is applied by the caller, not here.
  }
}
