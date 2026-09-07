---
name: Questly
description: Melbourne transit wayfinding for a group's night out — one orange route line, roundel stops, indicator-board plates.
colors:
  ground-night: "#3b3686"
  ground-night-deep: "#1a1640"
  ground-night-raised: "#453f95"
  ground-day: "#fdf8e1"
  ground-day-deep: "#f9dc5c"
  ground-day-raised: "#fae588"
  text-night: "#ffffff"
  text-day: "#1a1640"
  dim-night: "#b9b6e0"
  dim-day: "#5b5499"
  accent-night: "#edba40"
  accent-day: "#3b3686"
  action: "#e0652b"
  action-quiet-night: "#e28c33"
  action-quiet-day: "#ffd000"
  on-action: "#1a1640"
  action-edge-night: "#ffffff"
  action-edge-day: "#1a1640"
  rail: "#767ae6"
  hairline-night: "#524ca8"
  hairline-day: "#e8d48a"
  danger-night: "#ff9d7a"
  danger-day: "#a8320c"
typography:
  display:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontVariationSettings: "'wdth' 125, 'wght' 700"
    lineHeight: 0.92
    letterSpacing: "-0.035em"
  board:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontVariationSettings: "'wdth' 112, 'wght' 600"
    letterSpacing: "0.14em"
    textTransform: uppercase
  num:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontVariationSettings: "'wdth' 112, 'wght' 700"
    letterSpacing: "-0.02em"
    fontVariantNumeric: tabular-nums
  body:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontVariationSettings: "'wdth' 100, 'wght' 400"
rounded:
  sm: "5px"
  md: "6px"
spacing:
  node: "13px"
  rail-x: "26px"
components:
  plate-action:
    backgroundColor: "{colors.action}"
    textColor: "{colors.on-action}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
    height: "44px"
  plate-raised:
    backgroundColor: "{colors.ground-night-raised}"
    textColor: "{colors.text-night}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
    height: "44px"
  plate-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-night}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
    height: "44px"
  chip-selected:
    backgroundColor: "{colors.accent-night}"
    textColor: "{colors.ground-night}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
    height: "44px"
  chip-unselected:
    backgroundColor: "transparent"
    textColor: "{colors.dim-night}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
    height: "44px"
---

# Design System: Questly

## Overview

**Creative North Star: "The Network"**

Questly is Melbourne transit wayfinding applied to a night out: an orange route line runs down every list-shaped screen, roundel stops mark each item on it, and figures live on indicator-board plates that flip rather than fade. The product's own claim is explicit — "a route is not a grid" — so nothing here is a card grid or a feed; every screen is one stop on one line, and a screen offering two equal choices has stopped being wayfinding and gone back to being a browse surface.

The system is dark-first by construction, not by convention: `:root` in `globals.css` carries the night palette (iris ground, apricot accent, orange action) as the base definition, and the day palette is layered on top under `@media (prefers-color-scheme: light)` and `[data-theme="light"]`. Night is the primary use scene — a phone at 6pm deciding on tonight — and day is the override for planning on a tram at 11am. `ThemeToggle` exposes three states (Night / Auto / Day), not two, because "Auto" following the system default is the real default and a binary switch would silently discard it.

Accessibility is structural, not a pass at the end: WCAG 2.2 AA governs every colour pairing, `--on-action` sits at exactly 4.9:1 on `--action` with no headroom, and the system carries a dedicated `--action-edge` token purely to satisfy the 3:1 non-text contrast requirement on control boundaries. Confirmed rejections: no card-grid layout, no colour-only selection state, no emoji or unicode glyphs as icons (one drawn 24-box stroke set instead), no opacity trick on ink over an orange field.

**Key Characteristics:**
- Dark-first tokens; day is the override, not the base
- A vertical route line with roundel stops is the spine of list screens, not a grid
- One variable font (Archivo) doing three jobs via axis + case, not three font families
- Every quantity renders as a tabular figure — price, time, headcount, distance
- Selection and boundary are never carried by colour alone

## Colors

Two full palettes are pinned by brand, one per mode; roles are fixed, but which raw colour fills a role changes with the mode because the palette itself changes.

### Primary
- **Pure Orange** (`#e0652b`, `--action`): the CTA field colour in both modes. It is a **fill-only** colour — orange text measures 2.9:1 on iris and 3.5:1 on cornsilk, both AA failures, so it never carries text itself; `--on-action` (ink, `#1a1640`) sits on top at 4.9:1 in both modes.
- **Deep Orange** (`--action-quiet`, `#e28c33` night / `#ffd000` "jonquil" day): the secondary/quiet action fill, same no-text-on-it rule.

### Secondary
- **Apricot / Iris** (`--accent`): the one role that swaps its raw value by mode. Apricot (`#edba40`) is the night accent at 5.7:1 on iris; it measures only 1.8:1 on the day ground and is disqualified there, so Iris (`#3b3686`) takes the accent role by day at 9.6:1 on cornsilk. The role's meaning (price emphasis, live state, the number that matters) stays constant across the swap.

### Neutral
- **Ground** (`--ground`): Iris `#3b3686` at night, Cornsilk `#fdf8e1` by day — the base surface.
- **Ground Deep** (`--ground-deep`): Ink `#1a1640` at night (a colour derived for this project — neither shipped palette had a dark), Naples Yellow `#f9dc5c` by day — the page background under the surface.
- **Ground Raised** (`--ground-raised`): Periwinkle-tinted `#453f95` night / Jasmine `#fae588` day — one step up for cards and raised Plates. Depth is tonal layering across these three steps, not shadow stacking.
- **Text** (`--text`): white (10.2:1 on iris) at night, Ink (16.0:1 on cornsilk) by day.
- **Text Dim** (`--text-dim`): `#b9b6e0` (5.3:1) night / `#5b5499` (6.2:1) day — tinted from the ground's own hue, never plain gray, and valid **only against a `--ground`-family surface**, never against `--action` or `--action-quiet` (measured as low as 1.79:1 there).
- **Rail** (`--rail`, Periwinkle `#767ae6`): map/route line work only — 2.8:1 at night, under the 3:1 non-text floor, so it is `aria-hidden` and never the sole carrier of meaning.
- **Hairline** (`--hairline`): low-contrast divider colour, decorative only.
- **Danger** (`--danger`): `#ff9d7a` night (6.0:1) / `#a8320c` day (6.4:1) — over-budget and error states.

### Named Rules
**The Accent Swaps, the Meaning Doesn't Rule.** `--accent` changes raw value by mode (apricot night, iris day) because the night colour fails contrast in daylight; whatever fills the role, it is always the "this number/state matters" colour, never a decorative one.

**The Fill-Only Orange Rule.** `--action` and `--action-quiet` are field colours. They never render as text colour in either mode — every orange fails AA as foreground ink against both grounds.

**The Edge Carries the Boundary Rule.** `--action` cannot move (`--on-action` has no headroom at 4.9:1), yet orange fill alone measures only 2.95:1 (night) / 3.3:1 (day) against its ground — under SC 1.4.11's 3:1 for a control's visual boundary. `--action-edge` exists solely to close that gap: white at night, ink by day, each clearing 3:1 against *both* the ground outside and the orange fill inside.

## Typography

**Display Font:** Archivo (variable), pushed to the top of its width axis
**Body Font:** Archivo, normal width
**Label/Mono Font:** Archivo, `.board` and `.num` variation settings (not a separate family)

**Character:** One superfamily doing three jobs by axis and case rather than three typefaces — display wants width because signage wants width, not just weight; labels are uppercase indicator-board text; figures are always tabular because every number in the product is a price, a time, a headcount, or a distance.

### Hierarchy
- **Display** (wght 700, wdth 125, tight -0.035em tracking, line-height 0.92, `text-wrap: balance`): venue names, screen titles, the authored match/plan/booked headlines. Rendered sizes range from `text-[19px]` (card-level names) to fluid hero sizes (`clamp(3rem,11vw,8rem)` on the wordmark).
- **Board** (wght 600, wdth 112, uppercase, +0.14em tracking): the indicator-board label role — screen eyebrows ("The plan"), stop kind ("Meet"/"Main"/"After"), status lines ("Now boarding", "3 of 4 swiping"), button labels. This is the transit world's own signage convention, not a decorative kicker; it is used at 9–13px throughout.
- **Num** (wght 700, wdth 112, tabular-nums, -0.02em tracking): every price, time, distance, headcount, join code and reference number. `font-variant-numeric: tabular-nums` is set globally on `body`, so this is the default for figures, not an opt-in.
- **Body** (wght 400, wdth 100, normal case): descriptive copy, blurbs, notes — 12–15px, `leading-relaxed` or `leading-snug`.

### Named Rules
**The Board-Is-Not-a-Kicker Rule.** The `.board` uppercase-label treatment is the world's indicator-board signage, applied consistently to every short status/eyebrow/label string in the product. It is a system role, not an invented one-off ornament — but it is also the *only* small-caps label device in the system; do not add a second, differently-styled eyebrow convention.

## Layout

The spine of every list-like screen (mood picker, constraints, room roster, plan) is a vertical **route line** (`.rail`, 3px wide, `--action`, positioned `--rail-x: 26px` from the left edge) with **roundel stops** (`.node`, 13px circle, 3px border) at each item: hollow on `--ground` for "open", filled `--action` for "locked", and ringed `--accent` with a soft halo for "live". `RailEnd` caps the line exactly at the last stop's centre rather than the bottom of whatever content that stop grows to hold, so a subpixel layout never leaves a sliver of the line showing past the final stop. The line itself is `aria-hidden` — it never carries meaning without the node states and text beside it.

Phone-frame compositions on the direction page are a fixed 320×660px viewport for side-by-side comparison, not the responsive contract; production screens are mobile-first single-column layouts, typically `max-w-[560px]` centred, with 44px-minimum interactive rows stacked with consistent ~90–104px inter-stop rhythm along the rail.

## Elevation & Depth

Mostly flat. Depth is conveyed by tonal layering across three ground steps (`--ground` → `--ground-raised` → `--ground-deep`), not by a shadow vocabulary. The one shadow token, `--shadow`, is a soft ambient blur (`0 18px 40px -12px rgba(...)` night, tuned separately for day) used structurally on the phone-frame chrome and raised surfaces — never a hard offset, and never decorative for its own sake, consistent with the wayfinding world rather than a neobrutalist one.

### Shadow Vocabulary
- **`--shadow`** (soft, large-blur, negative-spread): the one elevation token, applied to raised containers (phone frames, elevated Plates/panels).

## Shapes

Corners are gently rounded and consistent across two steps: **6px** (`rounded-[6px]`) for Plates, panels and the CTA on the home screen; **5px** (`rounded-[5px]`) for the smaller Chip controls and inline action buttons. Borders are hairline dividers (`--hairline`) between rows/sections, and a dedicated `--action-edge` boundary on every orange-filled control (see Named Rules above). Circles are reserved for the route-line roundels; nothing else in the system uses a fully round silhouette.

## Components

### Plates (primary control primitive)
- **Shape:** 6px radius, 44px minimum height, full-width by default.
- **Variants:** `action` (orange fill, `on-action` ink, `action-edge` border — the primary CTA), `quiet` (deep-orange/jonquil fill, same edge treatment), `raised` (`ground-raised` fill, plain text), `ghost` (transparent, hairline border — never stacked over an orange field, where `text-dim` drops under AA).
- **Behavior:** a discriminated union — `href` (renders a `<Link>`, supports `aria-current`) is mutually exclusive with `onClick`/`disabled` (renders a `<button>`); passing both is a type error, not a silently-dropped prop. `selected` renders as a ring plus `aria-pressed` only when the prop is explicitly passed — a one-shot CTA gets no toggle semantics at all.
- **Label rule:** `label` never carries opacity (no headroom on the 4.9:1 `on-action` ratio); hierarchy against the optional `sub` line comes from the `.board` treatment, never from dimming.

### Chips (constraint inputs)
- **Style:** 5px radius, 44×44px minimum target, border by default (`border-dim`, since `border-hairline` measures an ineffective 1.44:1).
- **State:** selection is filled (`--accent` background, `--ground` text) plus `aria-pressed` — never colour alone. `face="num"` centres a short tabular value ("2", "$20", "Tonight"); `face="prose"` left-aligns a wrapping phrase (quiz answers).

### The Route Line (signature component)
`Rail` (the line, optionally dashed or animated in with a clip-path draw-on), `RailNode` (a stop: open/locked/live), `RailEnd` (caps the line at the true last stop). Together these are the spine every list screen shares — mood picker, constraints, room roster, match itinerary, plan — and are the visual thread that says "you are still in the same night."

### MapTile
A drawn SVG wayfinding placeholder (grid lines, an orange route stroke, a filled destination roundel) standing in for Google Places photography, which is neither art-directed nor guaranteed to exist. Drawn in the product's own visual language rather than left as a grey box.

### Icons
One drawn set: 24-unit viewBox, 2px stroke, round caps/joins, `currentColor`, no fills except where a shape is genuinely solid (e.g. the check/cross marks). Emoji and unicode glyphs are excluded by design.

## Do's and Don'ts

### Do:
- **Do** treat `:root` as the dark/night definition and the `@media (prefers-color-scheme: light)` / `[data-theme="light"]` blocks as the override — the file is dark-first, and any new token must be added to `:root` first.
- **Do** use `.board`/`.display`/`.num` for their established jobs (labels/status, headlines, figures) rather than arbitrary weight/tracking combinations.
- **Do** render every price, time, distance, headcount, and reference/join code with `.num` tabular figures.
- **Do** give every interactive control a 44×44px minimum target and a visible focus ring (`:focus-visible`, `--focus`, 3px offset).
- **Do** encode selection with fill **and** an ARIA state (`aria-pressed`/`aria-current`), never colour alone.

### Don't:
- **Don't** put opacity on text sitting over `--action` or `--action-quiet` — `--on-action` has no headroom at 4.9:1 and any opacity drops it under AA.
- **Don't** use `--action` or any orange-family colour as text/foreground ink in either mode; it is a fill-only colour.
- **Don't** let `--rail`/periwinkle carry meaning by itself — it fails the 3:1 non-text floor at night and is `aria-hidden` for a reason.
- **Don't** use emoji or unicode glyphs as icons; use the drawn 24-box stroke set.
- **Don't** lay out a list-like screen as a card grid — the route line and its roundel stops are the system's answer to that surface, not one option among several.
