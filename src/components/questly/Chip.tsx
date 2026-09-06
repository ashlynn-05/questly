"use client";

import type { ReactNode } from "react";

/** A constraint value. Selection shows as fill AND ring, never colour alone. */
export function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={[
        "num min-h-[44px] rounded-[5px] border px-3 text-[14px] transition-colors",
        selected
          ? "border-accent bg-accent text-ground"
          : "border-hairline bg-transparent text-dim hover:text-text",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
