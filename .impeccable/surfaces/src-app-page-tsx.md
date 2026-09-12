---
version: 1
slug: "src-app-page-tsx"
primary_target: "src/app/page.tsx"
related_targets: ["src/app/_components/landing"]
---

# Surface brief — the landing page (`src/app/page.tsx`)

**Scope.** The front door at `/`, plus the three components under
`src/app/_components/landing/`. Everything a visitor sees before they have an
account. Not the funnel, not the room, not the account screens — those belong to
the `src-app` brief and are a different mode.

**Mode: Persuade.** The visitor decides and acts. `src-app` is Operate because
its job is a task completed; this surface's job is a decision made, so design is
the product here rather than the frame around it.

## The visitor

Melbourne 20–34, mobile-first, socially active and budget-constrained, arriving
from a link somebody pasted in a group chat. They know the feeling being named —
forty messages, no plan — before they know the product.

**The job:** understand in one viewport that Questly ends the negotiation with one
bookable plan, then start a quest.

**The action:** one, and it is `/start`. It appears twice, in the hero and at the
sign-off, because the page is five screens long; that is the same action, not a
second one.

## What may be shown as proof

Nothing external. PRODUCT.md records the evidence on hand as none, so the only
honest proof is the interface itself: four real onboarding screens, cycling, and
four more fanned behind them. Demonstration data is authored at full fidelity and
labelled where a viewer could mistake it for a commitment.

**Forbidden here, permanently:** testimonials, customer or venue logos, "trusted
by", any named partner venue presented as real, any fabricated booking, user or
venue count, and App Store or Google Play badges — the platform is web and those
apps do not exist. The Melbourne market figures in the concept brief are the
founder's own sizing estimates and are research, not traction.

## Direction

The approved comp, reproduced, minus the three sections above. Centred hero over
two washes, the running product directly beneath it, then the reasons against a
short vertical line, the six-stop journey as a horizontal band, and the three
nights as one departures board.

**The memorable moment** is the indicator board landing. The headline flips once
on arrival and settles; the board's figures flip in sequence when scrolled into
view; the phone flips between its four screens. Nothing fades. `motion` is used
for exactly one thing, the phone's enter and exit through `AnimatePresence`;
everything else is `board-flip` from `globals.css`.

**What was cut from the comp, and why it stays cut:** the 1000px scroll-pinned
reasons section (a pin is the one scroll behaviour a visitor cannot opt out of),
the pointer parallax on the washes, the hover lifts, the `data-reveal`
fade-and-rise on nearly every element, and the infinitely cycling headline (WCAG
2.2 SC 2.2.2 would need a pause control, and a pause button on a headline is a
worse page than a headline that lands).

**Two defects in the comp, corrected rather than copied:** the reason titles are
painted in a cream-on-cream gradient that vanishes on the day ground, and the
hero washes are fixed at 1100px and 900px, which inside a phone column is all
centre and no falloff. Titles take `--text`; the washes take the section's width.


## The ground inversion, and why `/` does not use `Screen`

The Claude Design comp puts the PAGE on `--ground-deep` and floats `--ground`
panels on it: ink with iris cards at night, naples yellow with cornsilk cards
by day. `Screen` does the opposite -- it paints `--ground` and caps its measure
at 1120px -- because it is the product's shell, sized for a room. A front door
built inside it reads as a different design from the one that was drawn, and
the fan alone needs about 1100px of bleed.

So `/` carries its own shell. It keeps the one rule `Screen` states about every
route without exception: the wordmark is in the header, next to the same theme
toggle.

Two consequences that are easy to get wrong:

- `.node`, `.rail-end` and `Rail` MASK THEMSELVES WITH `--ground`, which works
  only while the element is on the page ground. On this page they would draw
  iris dots and an iris stripe. Every roundel and every route line here is
  written out with its fill stated -- 13px, a 3px `--action` ring, filled
  `--ground-deep`, exactly as the comp draws them.
- The route lines are capped at the last roundel's centre, per stop, because no
  single offset from a container edge lands there when the rows are uneven.
  `calc(100% / 6)` in particular overshoots by a whole grid gap.


## Motion, and the three rules it follows

The design drives everything off scroll: `data-reveal` on nearly every block, a
`railTick` that lights route stops at 60% of the window, a headline that cycles
between two lines forever, and a fan of cards that follows the pointer. All of
it is here, under three rules that the components state in their own comments.

1. **Content renders visible and the effect hides it, never the reverse.**
   `Reveal` and `FlipOnView` both do this. An observer that never fires costs an
   animation, not the page -- which matters, because observers do not fire in a
   background tab, a print stylesheet, or a crawler.
2. **The settled state is everything on.** `useRailTick` returns every stop lit
   and every line drawn, and only a live scroll takes it back. Reduced motion
   returns that state and stops.
3. **Nothing that moves is announced.** The cycling `<h1>` carries one fixed
   accessible name in an `sr-only` span and everything that rotates is
   `aria-hidden`, so the page's title never changes under a screen reader. That
   is also the answer to SC 2.2.2: nothing that moves carries information.

The one thing that did NOT come across is the scrolljack. The design pins the
reasons section for 1000px and the fan follows the pointer; the first steals
640px of scroll for three paragraphs and the second is a hover effect on a
touch screen. The reasons keep their marker on a real-scroll rail, and the fan
answers a drag instead, which is a gesture a phone actually has.

### The first viewport, and why it needed its own pass

The first build put all of the above below the fold. Measured on the running
page, ten reveals existed and every one of them sat between 1184px and 3912px
down the document, so the screen someone actually arrives on had no motion in it
at all until the headline cycled four seconds later. That is a page that reads
as a picture.

What fixed it: the design's own arrival sequence (eyebrow, subhead at 130ms,
buttons at 210ms, fan at 280ms), the design's own pointer parallax on the two
hero washes and the four fan cards, a scroll drift on the washes so the first
flick of the wheel moves something, and the fan dealing itself out of a stack.

One defect had to be fixed before any of that was visible. `Reveal` wrote its
hidden style and the observer's first callback for an already-visible element
arrived in the same frame, so the browser never painted the hidden state and the
transition had no start value -- the element snapped in and read as nothing
happening. The fix is a forced reflow, and the ORDER around it is load-bearing:
hide, flush, then arm the transition. Arming it first makes the hide itself
animate, and the block fades out for 620ms before it fades in.

### `--drift-x` and `--scroll`, not a value per element

`useCursorDrift` and `useScrollDrift` each attach one listener and write a CSS
custom property on a single host; the elements underneath read it inside their
own `transform` with a `0` fallback. Six elements each holding their own
scroll-linked value is six subscriptions and six re-renders a frame, and the
fallback is what makes a missing listener cost nothing -- which is the normal
case, because the pointer hook is `(pointer: fine)` only and this product is
used on a phone.

## Two sections that came back, relabelled

The design has "What our customers said?" over three personas and a marquee of
Melbourne venue logos. PRODUCT.md forbids testimonials, customer logos and named
partner venues outright, and this build has no customers.

What survived is the artwork without the claim. The heading is "Who this is
for.", the three people keep the design's own segment badges, and the venue row
keeps the design's own aspirational line: "Melbourne venues we would launch
with". Nothing on the page says these are customers or partners. `People.tsx`
and `Venues.tsx` both carry that reasoning at the top, because the edit that
breaks it is a one-word edit.

## The wordmark is the drawn mark now

`ThemeImage` moved to `src/components/questly/` and `Screen` uses it, so the
mark is the same artwork in the same place on every route including this one.
It is two `<img>` elements swapped by CSS rather than one `src` chosen in
JavaScript: the theme is resolved before paint by an inline script and nothing
exports it to React, so a JS choice would flash the night logo on a day page.

## Unresolved

- Real photography has never been commissioned for this product. If it ever is,
  the fan is where it lands.
- The signed-in hero variant has not been seen against a real deployment.
