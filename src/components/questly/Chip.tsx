"use client";

import type { ReactNode } from "react";

type Face = "num" | "prose";

/**
 * A constraint value. Selection shows as fill plus `aria-pressed`, never
 * colour alone -- there is no ring here, just the filled background and the
 * accessible state announcement.
 *
 * `face` picks the text treatment: "num" (the default) is a single tabular
 * figure or short word ("2", "$20", "Tonight"), centered and never wrapping.
 * "prose" is a full phrase (a quiz goal like "making an ordinary week feel
 * like an occasion") that needs to read left-to-right and wrap onto more
 * than one line without the centered, tabular treatment mangling it.
 */
export function Chip({
  selected,
  onClick,
  children,
  face = "num",
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  face?: Face;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={[
        "flex min-h-[44px] min-w-[44px] items-center rounded-[5px] border px-3 py-2 text-[14px] transition-colors",
        face === "num" ? "num justify-center" : "text-left leading-snug",
        selected
          ? "border-accent bg-accent text-ground"
          : // border-hairline measures 1.44:1 here -- effectively invisible.
            // border-dim reuses --text-dim (5.3:1 night / 6.2:1 day), the
            // same token this file already trusts for unselected text.
            "border-dim bg-transparent text-dim hover:text-text",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
