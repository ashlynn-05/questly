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
 * The same order, as an inline pre-paint script. Runs before paint so a stored
 * choice never flashes the other mode first; inlined deliberately, because a
 * deferred script is a visible repaint.
 *
 * Wrapped in an IIFE, as the Next docs' own example is, so `q` and `m` are not
 * two globals on every page in the app. "system" is the absence of the
 * attribute, which is why there is no `else` -- the stylesheet's
 * `prefers-color-scheme` rules are the fallback.
 */
export const themeScript = `(function(){try{var q=new URLSearchParams(location.search).get("theme");var m=(q==="light"||q==="dark")?q:localStorage.getItem("${THEME_STORAGE_KEY}");if(m==="light"||m==="dark")document.documentElement.setAttribute("data-theme",m)}catch(e){}})()`;
