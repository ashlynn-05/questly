"use client";

import { useEffect, useState } from "react";

type Mode = "system" | "dark" | "light";

/**
 * Three states, not two. "System" is the real default -- a two-way switch would
 * silently override whatever the phone already decided, which is the wrong
 * answer for a product used both at 6pm and at 11am.
 */
export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("system");

  useEffect(() => {
    const stored = localStorage.getItem("questly-theme") as Mode | null;
    if (stored) setMode(stored);
  }, []);

  function choose(next: Mode) {
    setMode(next);
    const root = document.documentElement;
    if (next === "system") {
      root.removeAttribute("data-theme");
      localStorage.removeItem("questly-theme");
    } else {
      root.setAttribute("data-theme", next);
      localStorage.setItem("questly-theme", next);
    }
  }

  const OPTIONS: Array<{ id: Mode; label: string }> = [
    { id: "dark", label: "Night" },
    { id: "system", label: "Auto" },
    { id: "light", label: "Day" },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Colour mode"
      className="inline-flex"
      style={{ background: "var(--ground-raised)" }}
    >
      {OPTIONS.map((o) => {
        const on = mode === o.id;
        return (
          <button
            key={o.id}
            role="radio"
            aria-checked={on}
            onClick={() => choose(o.id)}
            // 44px, not the 32px the padding alone gave: this product's own
            // target floor, the same one the landing page applies to the link
            // two lines away. The label is 10px, so the box has to make the
            // target, not the text.
            className="board flex min-h-[44px] min-w-[44px] items-center justify-center px-3.5 text-[10px]"
            style={
              on
                ? { background: "var(--action)", color: "var(--on-action)" }
                : { color: "var(--text)" }
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
 */
export const themeScript = `try{var q=new URLSearchParams(location.search).get("theme");var m=q||localStorage.getItem("questly-theme");if(m==="light"||m==="dark")document.documentElement.setAttribute("data-theme",m)}catch(e){}`;
