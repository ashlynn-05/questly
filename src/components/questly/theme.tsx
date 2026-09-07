"use client";

import { useEffect, useRef, useState } from "react";

type Mode = "system" | "dark" | "light";

/** One key, named once, shared by the toggle and the pre-paint script below. */
const STORAGE_KEY = "questly-theme";

const OPTIONS: Array<{ id: Mode; label: string }> = [
  { id: "dark", label: "Night" },
  { id: "system", label: "Auto" },
  { id: "light", label: "Day" },
];

/**
 * What the page is ACTUALLY running in, resolved exactly the way the pre-paint
 * script resolves it: `?theme=` wins, then the stored choice, then system.
 *
 * The two used to disagree. The script honoured `?theme=`; the toggle read only
 * `localStorage`. Open `/?theme=light` and the page rendered in day mode while
 * the toggle reported "Auto" as checked -- two sources of truth for one visible
 * state, and the switch lying about the thing it exists to control.
 */
function resolveMode(): Mode {
  try {
    const fromUrl = new URLSearchParams(location.search).get("theme");
    if (fromUrl === "light" || fromUrl === "dark") return fromUrl;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // No URL and no store to read (Safari's "Block All Cookies", some
    // embedded webviews). Whatever the OS says, then.
  }
  return "system";
}

/**
 * Three states, not two. "System" is the real default -- a two-way switch would
 * silently override whatever the phone already decided, which is the wrong
 * answer for a product used both at 6pm and at 11am.
 *
 * `role="radiogroup"` is a promise about behaviour, not just a name: exactly one
 * option is a tab stop, and the arrow keys move between them (and select as
 * they go, which is what the WAI-ARIA radio-group pattern specifies).
 */
export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("system");
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    // `location.search` and `localStorage` do not exist while this renders on
    // the server, so this read cannot move into the render body or a useState
    // initialiser: the hydration render has to produce what the server sent,
    // which is "system". A one-shot read of a browser store at mount has
    // nowhere to put its result except state, which is exactly the shape
    // `react-hooks/set-state-in-effect` flags -- and here nothing downstream
    // depends on the value at all. It drives this widget's own highlight and
    // nothing else; the DOM is already in the right mode, because the pre-paint
    // script below set `data-theme` before anything was drawn. So the worst
    // case this disable buys is one extra render of a three-button switch.
    // `useSyncExternalStore` would express the same thing without an effect;
    // it is not used because this value has no subscribers beyond this
    // component and no writer beyond `choose` below, which sets state directly.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode(resolveMode());
  }, []);

  function choose(next: Mode) {
    setMode(next);
    const root = document.documentElement;
    try {
      if (next === "system") {
        root.removeAttribute("data-theme");
        localStorage.removeItem(STORAGE_KEY);
      } else {
        root.setAttribute("data-theme", next);
        localStorage.setItem(STORAGE_KEY, next);
      }
    } catch {
      // The mode still changed for this page; only remembering it is lost.
      if (next === "system") root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", next);
    }
  }

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (index + step + OPTIONS.length) % OPTIONS.length;
    choose(OPTIONS[next].id);
    buttons.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label="Colour mode"
      // The group needs its own boundary: `--ground-raised` measures 1.17:1
      // against `--ground` in dark and 1.18:1 in light, so without this the
      // whole switch has no visible edge. `--text-dim` as a border is 5.26:1 /
      // 6.21:1 -- `--hairline` would be 1.44:1 / 1.39:1 and no better than
      // nothing.
      className="inline-flex shrink-0 rounded-[6px] border border-dim p-[2px]"
      style={{ background: "var(--ground-raised)" }}
    >
      {OPTIONS.map((o, i) => {
        const on = mode === o.id;
        return (
          <button
            key={o.id}
            ref={(node) => {
              buttons.current[i] = node;
            }}
            role="radio"
            aria-checked={on}
            // Exactly one tab stop for the group. Exactly one option is always
            // checked, so there is always exactly one.
            tabIndex={on ? 0 : -1}
            onClick={() => choose(o.id)}
            onKeyDown={(event) => onKeyDown(event, i)}
            // 44px, not the 32px the padding alone gave: this product's own
            // target floor, the same one the landing page applies to the link
            // two lines away. The label is 10px, so the box has to make the
            // target, not the text.
            //
            // The border is always there, transparent when unselected, so
            // selecting an option cannot shift the other two sideways.
            className="board flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[4px] border px-3.5 text-[10px]"
            style={
              on
                ? {
                    background: "var(--action)",
                    color: "var(--on-action)",
                    // The selected fill is 2.53:1 against this group's
                    // `--ground-raised` in dark and 2.74:1 in light -- under
                    // the 3:1 SC 1.4.11 asks of the visual indication of a
                    // state, and `--action` cannot move because `--on-action`
                    // is exactly 4.92:1 on it. So the edge carries the
                    // boundary, exactly as it does on every other orange field
                    // in this product: white in dark (8.76:1 on the raised
                    // surface, 3.46:1 on the fill), ink in light (13.49:1 and
                    // 4.92:1). See globals.css and Plate.tsx.
                    borderColor: "var(--action-edge)",
                  }
                : { color: "var(--text)", borderColor: "transparent" }
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Runs before paint so a stored choice never flashes the other mode first.
 * Inlined deliberately: a deferred script is a visible repaint.
 *
 * Wrapped in an IIFE, as the Next docs' own example is, so `q` and `m` are not
 * two globals on every page in the app. It resolves in the same order
 * `resolveMode` above does, and the two must stay in step.
 */
export const themeScript = `(function(){try{var q=new URLSearchParams(location.search).get("theme");var m=q||localStorage.getItem("${STORAGE_KEY}");if(m==="light"||m==="dark")document.documentElement.setAttribute("data-theme",m)}catch(e){}})()`;
