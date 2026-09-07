/**
 * One drawn icon set: 24-box, 2px stroke, round caps, no fills except where a
 * shape is genuinely solid. Emoji and unicode glyphs are not an icon system.
 */
type P = { className?: string };

const S = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export const People = (p: P) => (
  <svg {...S} {...p}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
    <path d="M16 5.5a3.2 3.2 0 0 1 0 5.6M17.5 14.9c2.1.7 3.5 2.6 3.5 5.1" />
  </svg>
);

export const Coin = (p: P) => (
  <svg {...S} {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7v10M14.6 9.4a2.9 2.9 0 0 0-2.6-1.3c-1.6 0-2.7.9-2.7 2.1 0 3 5.6 1.6 5.6 4.5 0 1.3-1.2 2.2-2.9 2.2a3.1 3.1 0 0 1-2.8-1.5" />
  </svg>
);

export const Clock = (p: P) => (
  <svg {...S} {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 6.8V12l3.4 2.1" />
  </svg>
);

export const Pin = (p: P) => (
  <svg {...S} {...p}>
    <path d="M12 21c4-4.4 6-7.7 6-10a6 6 0 1 0-12 0c0 2.3 2 5.6 6 10Z" />
    <circle cx="12" cy="11" r="2.4" />
  </svg>
);

export const Check = (p: P) => (
  <svg {...S} {...p}>
    <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />
  </svg>
);

export const Cross = (p: P) => (
  <svg {...S} {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const Lock = (p: P) => (
  <svg {...S} {...p}>
    <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
    <path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" />
  </svg>
);

export const Swap = (p: P) => (
  <svg {...S} {...p}>
    <path d="M4 8h13l-3.2-3.2M20 16H7l3.2 3.2" />
  </svg>
);

export const Hand = (p: P) => (
  <svg {...S} {...p}>
    <path d="M9 11V5.6a1.6 1.6 0 1 1 3.2 0V11m0-1.4a1.6 1.6 0 1 1 3.2 0V12m0-1a1.6 1.6 0 0 1 3.2 0v4.6A5.4 5.4 0 0 1 13 21h-1a5 5 0 0 1-4.3-2.4L4.9 15c-.6-1 .5-2.2 1.5-1.7L9 15" />
  </svg>
);

/**
 * The mark on a help trigger. Drawn rather than a `?` character for the reason
 * stated at the top of this file, and with a concrete second reason here: the
 * glyph sits inside a 24px roundel beside an 11px label, and a text `?` in the
 * body face lands off-centre in that circle and changes size with the label it
 * happens to sit next to. A path is the same shape at every size.
 *
 * No enclosing circle in the artwork -- the roundel around it is the circle,
 * and drawing a second one inside would be a ring in a ring.
 */
export const Question = (p: P) => (
  <svg {...S} {...p}>
    {/* Bowl and stem in one path: the large-arc sweep is what gives the hook
        its ~270 degrees rather than a shallow curve that reads as a comma. */}
    <path d="M8.6 9a3.4 3.4 0 1 1 3.4 3.4v2.4" />
    {/* A dot, not a period: a short segment with the file's round line caps. A
        zero-length path is the tidier spelling and does not render in every
        engine. */}
    <path d="M12 18v.2" />
  </svg>
);
