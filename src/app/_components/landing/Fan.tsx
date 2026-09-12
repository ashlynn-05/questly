"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { PhoneFlow } from "./PhoneFlow";
import { useCursorDrift } from "./useCursorDrift";

/**
 * The design's fan: four tilted cards behind one phone, all standing on a
 * `--ground` swell that rises out of the `--ground-deep` page.
 *
 * ALL FIVE CARDS AT EVERY WIDTH, AND THE FAN IS DRAGGABLE. The spread is 330px
 * either side of centre plus a 190px card, so it needs about 860px of room and
 * a phone has 350. The earlier build answered that by dropping the four side
 * cards below `xl`, which meant the phone saw a single card where the design
 * has five. So the fan keeps its real geometry at every width and the strip it
 * sits on is draggable: the cards that do not fit are off the side of a thing
 * you can pull, rather than deleted.
 *
 * Drag is enabled only when there is something to reach -- at `xl` the whole
 * fan is on screen and `overflow` is 0, which makes the constraints zero-width
 * and the strip immovable. That is deliberate: a grab cursor on a thing that
 * cannot move is a broken affordance.
 *
 * THE CLIPPING WINDOW IS A SEPARATE ELEMENT from the positioning context, and
 * it clips on X ONLY. The fan must not add horizontal page scroll on a phone,
 * but the cards hang 40px BELOW their baseline by design and the ground swell
 * bleeds past both page gutters -- so the swell sits outside the window, and
 * the window pairs `overflow-x: clip` with `overflow-y: visible`.
 *
 * WHY THE CARDS ARE `aria-hidden` AND THE PHONE IS NOT. The four cards are
 * decoration: every fact on them is said again in words further down the page.
 * The phone is the same, but it carries the one visually-hidden sentence that
 * describes what the whole block is showing -- and `aria-hidden` is inherited
 * by a subtree and cannot be undone by a descendant, so hiding the wrapper
 * would silently delete that sentence. The cards are hidden one by one instead.
 * Nothing reachable only by dragging is information; the drag is a way to look
 * at the artwork, not a way to read the page.
 *
 * WHY NOT `Rail`/`RailNode` FOR THE LINE ON THE FIRST CARD: `.node` and
 * `.rail-end` paint themselves `--ground` to mask the line, which works only
 * while the element is on the page ground. These cards ARE `--ground`, but the
 * page under them is `--ground-deep`, so the primitives are written out here
 * with the fill stated rather than inherited.
 */

/**
 * Half the fan's drawn width, in pixels. The outer card's centre is 330px out
 * and its rotated corner reaches another ~141px past that; `zoom: 0.9` scales
 * both. Rounded up, because the number decides how far the strip may be pulled
 * and stopping short leaves a card permanently half off the screen.
 */
const HALF = 430;

/** The two outer cards: 190x380, dropped 40px below the baseline. */
const DEAL =
  "transition-[transform,opacity] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none";

const CARD_SM = `absolute bottom-[-40px] flex h-[380px] w-[190px] flex-col justify-center overflow-hidden rounded-[18px] border border-hairline bg-ground px-[15px] py-[18px] ${DEAL}`;
/** The two inner cards: 210x420, dropped 10px. */
const CARD_LG = `absolute bottom-[-10px] flex h-[420px] w-[210px] flex-col justify-center overflow-hidden rounded-[20px] border border-hairline bg-ground px-[17px] py-[20px] ${DEAL}`;

/**
 * `zoom: 0.9` is the design's own `.fanzoom`, and it is load-bearing rather than
 * cosmetic: at full size the 15px display titles on the 190px cards run past
 * the card edge and get clipped by `overflow-hidden`. Scaling the whole card
 * keeps the type relationships the design drew instead of retuning six sizes.
 *
 * `drift` is the design's `data-cursor` strength for this card -- -40, -22, 22,
 * 40, outermost first. It is composed into the same `transform` as the fan
 * geometry rather than applied to a wrapper, so one property animates and the
 * card's resting position stays exactly where `x` and `deg` put it. With no
 * pointer listener attached, `--drift-x` falls back to 0 and the term vanishes.
 *
 * `dealt` is the arrival: before it, every card is stacked dead centre with no
 * rotation, and the transition below carries it out to its place. The
 * transition is on the card, so a pointer drift that arrives mid-deal rides the
 * same curve instead of fighting it.
 */
function place(
  x: number,
  deg: number,
  w: number,
  drift: number,
  dealt: boolean,
  delay: number,
) {
  return {
    left: "50%",
    marginLeft: -w / 2,
    transform: dealt
      ? `translateX(calc(${x}px + var(--drift-x, 0) * ${drift}px)) rotate(${deg}deg)`
      : "translateX(0px) rotate(0deg)",
    opacity: dealt ? 1 : 0,
    // Only on the way OUT. A delay on the stack would hold each card at its
    // place for the length of it, and the deal would then start from a frame
    // where nothing had moved yet.
    transitionDelay: dealt ? `${delay}ms` : "0ms",
    boxShadow: "var(--shadow)",
    zoom: 0.9,
  } as const;
}

/** A row in the room card. */
function Seat({ name, state }: { name: string; state: "swiping" | "waiting" }) {
  return state === "swiping" ? (
    <span className="flex justify-between rounded-[5px] bg-ground-raised px-[11px] py-[9px]">
      <span className="board text-[10px]">{name}</span>
      <span className="board text-[9px] text-accent">swiping</span>
    </span>
  ) : (
    <span className="flex justify-between rounded-[5px] border border-dashed border-dim px-[11px] py-[9px] text-dim">
      <span className="board text-[10px]">{name}</span>
      <span className="board text-[9px]">waiting</span>
    </span>
  );
}

export function Fan() {
  const window_ = useRef<HTMLDivElement>(null);
  /** How far the strip may travel each way. 0 means the fan already fits. */
  const [overflow, setOverflow] = useState(0);
  /**
   * Starts TRUE, the same rule the reveals on this page follow: the finished
   * fan is what a browser that runs no effects renders. The effect below is
   * what stacks the cards, and only when there is going to be an animation to
   * carry them back out.
   */
  const [dealt, setDealt] = useState(true);

  useCursorDrift(window_);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let deal = 0;
    // Stacked on the next frame, dealt a few frames after that. The gap is the
    // whole point: the stacked state has to be committed AND PAINTED before the
    // deal starts, or both writes land in one style flush and the cards appear
    // at their places with no travel -- the same failure `Reveal` forces a
    // reflow to avoid. Neither call sits in the effect body, which is also what
    // keeps this the right side of `react-hooks/set-state-in-effect`.
    const stack = requestAnimationFrame(() => {
      setDealt(false);
      deal = window.setTimeout(() => setDealt(true), 60);
    });

    return () => {
      cancelAnimationFrame(stack);
      clearTimeout(deal);
    };
  }, []);

  useEffect(() => {
    const el = window_.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setOverflow(Math.max(0, Math.round(HALF - entry.contentRect.width / 2)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="relative mt-8 h-[520px]">
      {/* The ground swell. The `--ground` panel that the reasons section
          continues, arriving under the fan as a curve rather than an edge. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-16 left-[-20px] right-[-20px] z-0 h-[92px] lg:left-[-40px] lg:right-[-40px] xl:left-[-72px] xl:right-[-72px]"
        style={{
          background: "var(--ground)",
          borderRadius: "50% 50% 0 0 / 70px 70px 0 0",
        }}
      />

      <div
        ref={window_}
        className="absolute inset-0 overflow-x-clip overflow-y-visible"
      >
        <motion.div
          className={`absolute inset-0 ${overflow ? "cursor-grab active:cursor-grabbing" : ""}`}
          // `pan-y` is motion's own default for a horizontal drag, and it is the
          // reason a thumb travelling down the page still scrolls it.
          drag={overflow ? "x" : false}
          dragConstraints={{ left: -overflow, right: overflow }}
          dragElastic={0.06}
        >
          {/* 1. Your detours */}
          <div
            className={CARD_SM}
            style={place(-330, -15, 190, -40, dealt, 0)}
            aria-hidden="true"
          >
            <p className="board m-0 mb-3 text-[9px] text-accent">
              Your detours
            </p>
            <div className="relative pl-[22px]">
              <span className="absolute top-1 bottom-1 left-1 w-[3px] rounded-[2px] bg-action" />
              <div className="flex flex-col gap-[14px]">
                <div>
                  <span className="absolute left-0 size-[11px] rounded-full bg-accent" />
                  <p className="display m-0 text-[15px]">Merri Creek loop</p>
                  <p className="num m-0 mt-[2px] text-[11px] text-dim">
                    $0 · Fri
                  </p>
                </div>
                <div>
                  <p className="display m-0 text-[15px]">The Alley Kiln</p>
                  <p className="num m-0 mt-[2px] text-[11px] text-dim">
                    $18 · Sat
                  </p>
                </div>
                <div>
                  <p className="display m-0 text-[15px]">Rooftop market</p>
                  <p className="num m-0 mt-[2px] text-[11px] text-dim">
                    $12 · Sun
                  </p>
                </div>
              </div>
            </div>
            <p className="m-0 mt-3 text-[9px] leading-snug text-dim">
              Demonstration data.
            </p>
          </div>

          {/* 2. The room */}
          <div
            className={CARD_LG}
            style={place(-178, -8, 210, -22, dealt, 90)}
            aria-hidden="true"
          >
            <p className="board m-0 mb-[14px] text-[9px] text-accent">
              Room 4821 · live
            </p>
            <h3 className="display m-0 mb-[14px] text-[24px]">
              3 of 4 swiping.
            </h3>
            <div className="flex flex-col gap-[7px]">
              <Seat name="Bea" state="swiping" />
              <Seat name="Sam" state="swiping" />
              <Seat name="Nour" state="swiping" />
              <Seat name="Ari" state="waiting" />
            </div>
            <p className="m-0 mt-3 text-[9px] leading-snug text-dim">
              A simulated room.
            </p>
          </div>

          <PhoneFlow />

          {/* 3. The swipe deck */}
          <div
            className={CARD_LG}
            style={place(178, 8, 210, 22, dealt, 90)}
            aria-hidden="true"
          >
            <p className="board m-0 mb-3 text-[9px] text-accent">
              Swipe · 6 left
            </p>
            <div className="flex h-[210px] flex-col justify-end rounded-[5px] border border-hairline bg-ground-raised p-3">
              <p className="display m-0 text-[20px]">The Alley Kiln</p>
              <p className="m-0 mt-1 text-[10px] text-dim">
                Collingwood · 12 min tram
              </p>
              <div className="mt-2 flex gap-[10px]">
                <span className="num text-[13px] text-accent">$18</span>
                <span className="num text-[13px] text-accent">7:30</span>
              </div>
            </div>
            <div className="mt-3 flex gap-[7px]">
              <span className="board flex min-h-[44px] flex-1 items-center justify-center rounded-[5px] border border-dim text-[10px] text-text">
                Pass
              </span>
              <span className="board flex min-h-[44px] flex-1 items-center justify-center rounded-[5px] border border-action-edge bg-action text-[10px] text-on-action">
                Yes
              </span>
            </div>
            <p className="m-0 mt-3 text-[9px] leading-snug text-dim">
              Demonstration data.
            </p>
          </div>

          {/* 4. Booked. The comp gives this a street number; a fabricated address
          is the one detail a cropped screenshot reads as a real record. */}
          <div
            className={CARD_SM}
            style={place(330, 15, 190, 40, dealt, 0)}
            aria-hidden="true"
          >
            <p className="board m-0 mb-3 text-[9px] text-accent">Booked</p>
            <h3 className="display m-0 mb-3 text-[22px]">Tonight, 7:30.</h3>
            <div className="rounded-[5px] bg-ground-raised p-3">
              <p className="display m-0 text-[18px]">The Alley Kiln</p>
              <p className="m-0 mt-[5px] text-[10px] text-dim">Collingwood</p>
              <div className="mt-[9px] flex gap-3">
                <span className="num text-[14px] text-accent">$18</span>
                <span className="num text-[14px] text-accent">4 heads</span>
              </div>
            </div>
            <p className="m-0 mt-[10px] text-[9px] text-dim">
              This booking is simulated.
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
