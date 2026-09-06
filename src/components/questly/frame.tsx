import type { ReactNode } from "react";

/**
 * A phone at real device width. The direction page shows screens side by side,
 * so they need a hard boundary and a fixed viewport -- these are compositions
 * to judge, not a responsive layout.
 */
export function Phone({
  label,
  note,
  children,
}: {
  label: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <figure className="m-0 flex w-[320px] shrink-0 flex-col gap-3">
      <div
        className="relative h-[660px] w-full overflow-hidden rounded-[26px] bg-ground"
        style={{ boxShadow: "var(--shadow)" }}
      >
        {children}
      </div>
      <figcaption className="pl-1">
        <p className="board text-[10px] text-accent">{label}</p>
        <p className="mt-1 text-[12px] leading-snug text-dim">{note}</p>
      </figcaption>
    </figure>
  );
}

/**
 * Wayfinding tile. Venue photography comes from Google Places and is neither
 * art-directed nor guaranteed to exist, so the loading and no-photo state is
 * drawn in the product's own language rather than left as a grey rectangle.
 */
export function MapTile({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 320 190"
      className={className}
      role="img"
      aria-label="Map of the area around this venue"
      preserveAspectRatio="xMidYMid slice"
    >
      <rect width="320" height="190" fill="var(--ground-raised)" />
      <g stroke="var(--hairline)" strokeWidth="1.5">
        <path d="M-10 42h340M-10 104h340M-10 158h340" />
        <path d="M58 -10v210M148 -10v210M242 -10v210" />
      </g>
      <path
        d="M-10 158 L58 158 L58 104 L148 104 L148 42 L242 42 L242 -10"
        fill="none"
        stroke="var(--rail)"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.85"
      />
      <g fill="var(--ground)" opacity="0.55">
        <rect x="168" y="118" width="52" height="34" rx="2" />
        <rect x="74" y="56" width="44" height="30" rx="2" />
      </g>
      <circle cx="148" cy="104" r="11" fill="var(--action)" />
      <circle cx="148" cy="104" r="4" fill="var(--ground)" />
    </svg>
  );
}
