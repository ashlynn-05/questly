"use client";

import { useRef, useState, type RefObject } from "react";
import {
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useTransform,
  type PanInfo,
} from "motion/react";
import { useHaptics } from "@haptics/react";
import { MapTile } from "@/components/questly/frame";
import { swipeIntent } from "@/lib/swipe";
import type { RoomView } from "../page";

/**
 * One card, and the gesture that votes on it.
 *
 * WHY THIS IS ITS OWN COMPONENT rather than markup inside `Deck`: each card
 * needs its OWN `useMotionValue`. A single `x` shared across the deck is read
 * by the card flying out AND by the card arriving behind it, so resetting it
 * for the new card snaps the departing one back to centre mid-flight. Keying a
 * child component is what gives each card its own. `Deck` also has two early
 * returns above the card -- "no cards yet" and "you are through the deck" --
 * that every hook here would otherwise have to sit above.
 *
 * `Deck` keeps everything it already owned: the index, the mutation, the
 * in-flight guard, the buttons, the live region. This component knows about
 * pointers and nothing else.
 */
export function SwipeCard({
  quest,
  src,
  headingRef,
  onLean,
  onCommit,
}: {
  quest: RoomView["quests"][number];
  /** Already resolved by `photoSrc`; null when this card has no photo. */
  src: string | null;
  headingRef: RefObject<HTMLHeadingElement | null>;
  /** Which plate should light up, or null for none. */
  onLean: (dir: "yes" | "no" | null) => void;
  onCommit: (dir: "yes" | "no") => void;
}) {
  const reduceMotion = useReducedMotion();

  /**
   * No `HapticsProvider` above this, deliberately. `useHaptics` falls back to
   * the library's own PRESETS when there is no context, and the provider's
   * only jobs are custom patterns, `respectReducedMotion`, a debug overlay,
   * and attaching an invisible `<input type="checkbox" switch>` INSIDE every
   * `[data-haptic]` element. This card wants none of the first three, and the
   * fourth would put an input under the drag surface, competing for the
   * pointer stream the gesture depends on.
   *
   * `respectReducedMotion` stays off (its default) on purpose: reduced motion
   * is a question about what MOVES on screen, and both mobile platforms ship
   * a separate system haptics switch that already governs this.
   *
   * In practice this is Android. Safari never implemented the Vibration API,
   * and the checkbox-switch side effect that stood in for it was closed in
   * iOS 26.5 -- only a real tap on the overlay fires now. So on an iPhone
   * these two lines are no-ops and the lit plate does all the talking.
   */
  const { trigger } = useHaptics();

  const card = useRef<HTMLElement>(null);
  const x = useMotionValue(0);

  /**
   * Five degrees, clamped, from a pivot BELOW the card.
   *
   * Half what a card-flinging deck uses, because this product's motion is a
   * departure board and not a magic trick. The origin below the card is what
   * makes it swing off the route line rather than spin about its own middle
   * like a playing card.
   */
  const rotate = useTransform(x, [-260, 0, 260], [-5, 0, 5], { clamp: true });

  /** Where the card leaves. Null for a card replaced by a button or a key. */
  const [exit, setExit] = useState<"yes" | "no" | null>(null);

  /**
   * What the parent was last told. Without it `onLean` would fire on every
   * animation frame rather than once per crossing -- and the haptic hung off
   * the same event would buzz sixty times a second.
   */
  const leaning = useRef<"yes" | "no" | null>(null);

  /**
   * Set the moment the vote is cast, and never cleared: this card is on its
   * way off the screen and has nothing left to say.
   *
   * It is not bookkeeping. The exit animation drives `x` out to ±420, which
   * re-crosses the very threshold the drag just crossed, and without this the
   * card buzzed a THIRD time on its way out -- measured, not guessed:
   * `navigator.vibrate` logged [8,27,5,5], [18,19,6,9], [8,27,5,5] for one
   * swipe. A ref rather than state because the exit is already running and a
   * re-render would be pure waste.
   */
  const committed = useRef(false);

  useMotionValueEvent(x, "change", (dx) => {
    if (committed.current) return;
    const next = swipeIntent(dx, card.current?.offsetWidth ?? 0);
    if (next === leaning.current) return;
    leaning.current = next;
    onLean(next);
    // Once per crossing, never per frame -- which is the whole reason the
    // `leaning` ref above exists. Silent on the way back out, because a plate
    // going dark is not news the thumb needs.
    if (next) trigger("impact-light");
  });

  function end(_event: PointerEvent | MouseEvent | TouchEvent, info: PanInfo) {
    const dir = swipeIntent(info.offset.x, card.current?.offsetWidth ?? 0);
    if (!dir) {
      // Short of the mark. `dragSnapToOrigin` springs the card back by itself;
      // all this has to do is put the plate out.
      leaning.current = null;
      onLean(null);
      return;
    }
    // The same tick for yes and for no. Giving "I'm in" the stronger buzz
    // would be the interface editorialising about which answer is better,
    // inside a vote a whole group is casting.
    trigger("impact-medium");
    committed.current = true;
    setExit(dir);
    onCommit(dir);
  }

  return (
    <motion.article
      ref={card}
      /* `drag` sets `touch-action: pan-y` itself, so the page still scrolls
         vertically under a horizontal drag and nothing is needed in
         globals.css.

         NOT gated on the in-flight guard, deliberately. That guard lives in a
         ref, which is exactly what makes it strict -- it is set synchronously
         and does not wait for a render -- and reading a ref during render is
         how you get a stale prop. `Deck.swipe` checks it and is the only path
         to `swipes.cast`, so a fast second drag cannot vote. What it CAN do is
         move the card, and `dragSnapToOrigin` then puts it back: honest, and
         better than a card that goes dead under a finger with no explanation. */
      drag="x"
      dragSnapToOrigin
      onDragEnd={end}
      style={{ x, rotate: reduceMotion ? 0 : rotate, transformOrigin: "50% 130%" }}
      exit={
        reduceMotion
          ? { opacity: 0, transition: { duration: 0 } }
          : {
              // A committed card leaves along the line it was dragged down. A
              // card replaced by a button press or an arrow key has no
              // direction to leave in, so it just goes.
              x: exit === "yes" ? 420 : exit === "no" ? -420 : 0,
              opacity: 0,
              transition: { duration: 0.18, ease: [0.16, 1, 0.3, 1] },
            }
      }
      transition={
        reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 40 }
      }
      /* Both cards share one grid cell (see the wrapper in `Deck`), so the
         card on its way out overlaps the one arriving instead of pushing it
         down the page. */
      className="col-start-1 row-start-1 overflow-hidden rounded-[10px] bg-ground-raised"
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- Places photo URLs are signed redirects, not a fixed remote pattern
        <img
          src={src}
          alt=""
          // Otherwise the browser's own image drag starts instead of ours, and
          // the card sits still while a ghost of the photo follows the cursor.
          draggable={false}
          className="h-[200px] w-full object-cover"
        />
      ) : (
        <MapTile className="h-[200px] w-full" />
      )}

      <div className="flex flex-col gap-3 p-4">
        <h1 ref={headingRef} tabIndex={-1} className="display text-[28px] text-text">
          {quest.title}
        </h1>
        {quest.blurb ? (
          <p className="text-[14px] leading-snug text-dim">{quest.blurb}</p>
        ) : null}

        <dl className="m-0 flex flex-wrap gap-x-6 gap-y-3">
          <div>
            {/* R68: when there IS a figure it comes from a Google price level,
                not from the venue, so it is labelled as an estimate everywhere
                it appears. When there is not one, the backend says so honestly
                rather than inventing a band -- and "we do not know what this
                costs" and "we estimate it costs $35" are different sentences
                that must not share a template. */}
            <dt className="board text-[10px] text-dim">
              {quest.priceCents !== null ? "Est. each" : "Cost"}
            </dt>
            <dd className="num m-0 text-[18px] text-text">
              {quest.priceCents !== null ? quest.priceLabel : "Not listed"}
            </dd>
          </div>
          <div>
            <dt className="board text-[10px] text-dim">Away</dt>
            <dd className="num m-0 text-[18px] text-text">{quest.distanceKm} km</dd>
          </div>
          {quest.discountPct > 0 ? (
            <div>
              <dt className="board text-[10px] text-dim">Offer</dt>
              <dd className="num m-0 text-[18px] text-accent">−{quest.discountPct}%</dd>
            </div>
          ) : null}
        </dl>
      </div>
    </motion.article>
  );
}
