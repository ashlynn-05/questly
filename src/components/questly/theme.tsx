"use client";

import { useEffect, useState } from "react";
import { applyThemeColor, resolveThemeMode, THEME_STORAGE_KEY, type ThemeMode } from "@/lib/theme";
import { MenuRoundel } from "./MenuRoundel";

/**
 * The colour switch, collapsed from a three-button bar into one roundel.
 *
 * The export keeps its old name because ten screens mount it and none of them
 * cared which shape it was.
 *
 * The bar spent about 200px of every header on a control almost nobody touches
 * twice, and it sat next to the account link with no visual relationship to it.
 * Both are now nodes on the header: same size, same shape, same interaction.
 *
 * Still three states, not two. "System" is the real default -- a two-way switch
 * silently overrides whatever the phone already decided, which is the wrong
 * answer for a product used both at 6pm and at 11am. Collapsing to a cycling
 * button was the other option and is rejected: cycling hides two of the three
 * options behind a guess about what comes next, and there is nowhere else in
 * this product they could be discovered.
 */

const OPTIONS: Array<{ id: ThemeMode; label: string }> = [
  { id: "dark", label: "Night" },
  { id: "system", label: "Auto" },
  { id: "light", label: "Day" },
];

/**
 * The glyph is drawn, not lettered, because the roundel is 44px and three
 * different words do not fit one. Shape carries the state, not colour: a moon,
 * a half-lit circle, a sun -- distinguishable without seeing the difference
 * between apricot and iris.
 */
function Glyph({ mode }: { mode: ThemeMode }) {
  if (mode === "dark") {
    return (
      <svg viewBox="0 0 20 20" className="size-[18px]" aria-hidden="true" fill="currentColor">
        <path d="M16.3 12.9A7.2 7.2 0 0 1 7.1 3.7a7.2 7.2 0 1 0 9.2 9.2Z" />
      </svg>
    );
  }
  if (mode === "light") {
    return (
      <svg viewBox="0 0 20 20" className="size-[18px]" aria-hidden="true" fill="currentColor">
        <circle cx="10" cy="10" r="4.1" />
        <g stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
          <path d="M10 1.6v2.2M10 16.2v2.2M18.4 10h-2.2M3.8 10H1.6M15.9 4.1l-1.6 1.6M5.7 14.3l-1.6 1.6M15.9 15.9l-1.6-1.6M5.7 5.7 4.1 4.1" />
        </g>
      </svg>
    );
  }
  // Auto: half the roundel lit. The same "it depends" the setting means.
  return (
    <svg viewBox="0 0 20 20" className="size-[18px]" aria-hidden="true">
      <circle cx="10" cy="10" r="7.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M10 2.8a7.2 7.2 0 0 1 0 14.4Z" fill="currentColor" />
    </svg>
  );
}

export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>("system");

  useEffect(() => {
    // `location.search` and `localStorage` do not exist while this renders on
    // the server, so this read cannot move into the render body or a useState
    // initialiser: the hydration render has to produce what the server sent,
    // which is "system". Nothing downstream depends on the value -- the DOM is
    // already in the right mode, because the pre-paint script in `@/lib/theme`
    // set `data-theme` before anything was drawn, resolving through the same
    // `resolveThemeMode` so the two cannot disagree. The worst this disable
    // buys is one extra render of one roundel.
    let resolved: ThemeMode = "system";
    try {
      resolved = resolveThemeMode(
        new URLSearchParams(location.search).get("theme"),
        localStorage.getItem(THEME_STORAGE_KEY),
      );
    } catch {
      // No URL and no store to read (Safari's "Block All Cookies", some
      // embedded webviews). Whatever the OS says, then.
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode(resolved);

    // Re-apply the attribute the pre-paint script set. A no-op in production,
    // where nothing has cleared it. In development, React's Strict Mode
    // remounts once and resets <html> to only the attributes it owns from JSX,
    // dropping `data-theme` -- so a stored "light" silently reverted to the OS
    // mode a moment after load, with this control still (correctly) showing Day.
    try {
      const root = document.documentElement;
      if (resolved === "system") root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", resolved);
    } catch {
      // Nothing to recover: the page keeps whatever mode it painted in.
    }

    // In "system" the browser's own furniture has to follow the OS the way the
    // stylesheet already does: `prefers-color-scheme` re-resolves `--ground` by
    // itself, but the `theme-color` meta is a fixed string and would sit at
    // last night's colour when the phone flips to Day at sunrise with the tab
    // still open. Only "system" listens -- an explicit choice is not the OS's
    // to change. Returned as this effect's cleanup, so a remount does not stack
    // listeners.
    if (resolved !== "system") return;
    try {
      const query = matchMedia("(prefers-color-scheme: light)");
      const sync = () => applyThemeColor("system");
      query.addEventListener("change", sync);
      return () => query.removeEventListener("change", sync);
    } catch {
      // No matchMedia (or it is locked down): the tint stays where the
      // pre-paint script put it, which is right for the mode the page loaded in.
    }
  }, []);

  function choose(next: ThemeMode) {
    setMode(next);
    const root = document.documentElement;
    // The browser's status bar and title bar are part of this switch's job:
    // leave them and picking Day on a dark phone paints a cornsilk page under
    // an iris status bar. Outside the try below because it has its own.
    applyThemeColor(next);
    try {
      if (next === "system") {
        root.removeAttribute("data-theme");
        localStorage.removeItem(THEME_STORAGE_KEY);
      } else {
        root.setAttribute("data-theme", next);
        localStorage.setItem(THEME_STORAGE_KEY, next);
      }
    } catch {
      // The mode still changed for this page; only remembering it is lost.
      if (next === "system") root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", next);
    }
  }

  const current = OPTIONS.find((o) => o.id === mode) ?? OPTIONS[1];

  return (
    <MenuRoundel
      // The current state is IN the name, because the glyph alone cannot say
      // it to a screen reader and "Colour mode" would leave somebody with no
      // way to know what it is set to without opening the menu.
      label={`Colour mode: ${current.label}`}
      items={OPTIONS.map((o) => ({
        // A tick would be colour-and-glyph on a row that already has a label,
        // so the current one says so in words instead.
        label: o.id === mode ? `${o.label} — on` : o.label,
        onSelect: () => choose(o.id),
      }))}
    >
      <Glyph mode={mode} />
    </MenuRoundel>
  );
}
