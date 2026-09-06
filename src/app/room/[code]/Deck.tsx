"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { Plate } from "@/components/questly/Plate";
import { MapTile } from "@/components/questly/frame";
import { userMessage } from "@/lib/errors";
import type { RoomView } from "./page";

/**
 * Where a Places photo is fetched from. The card stores Google's opaque photo
 * name, never a media URL, and this endpoint attaches the key inside the
 * deployment -- so no API key of ours ever reaches the browser.
 */
const CONVEX_SITE = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;

function photoSrc(quest: RoomView["quests"][number]): string | null {
  // A partner's own hosted image wins; it is the picture they supplied.
  if (quest.photoUrl) return quest.photoUrl;
  if (quest.photoName && CONVEX_SITE) {
    return `${CONVEX_SITE}/places/photo?name=${encodeURIComponent(quest.photoName)}&maxWidthPx=800`;
  }
  return null;
}

/** "Tam", "Tam and Bec", "Tam, Bec and Sam" -- read out, not comma-jammed. */
function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function Deck({
  view,
  code,
  sessionKey,
  headingRef,
}: {
  view: RoomView;
  code: string;
  sessionKey: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const cast = useMutation(api.swipes.cast);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // R34: your position in the deck is YOUR swipe count, never a shared cursor.
  // Two people swipe at different speeds, and a shared index would show one of
  // them a card they had already answered.
  const index = view.progress.swipedByYou;
  const quest = view.quests[index];
  const deckSize = view.quests.length;
  const waiting = view.progress.waitingOn;
  const through = view.members.length - waiting.length;

  const swipe = useCallback(
    async (dir: "yes" | "no") => {
      if (!quest || busy) return;
      setBusy(true);
      setError(null);
      try {
        await cast({ code, sessionKey, questId: quest._id, dir });
      } catch (e) {
        setError(userMessage(e, "That did not register. Try that one again."));
      } finally {
        setBusy(false);
      }
    },
    [quest, busy, cast, code, sessionKey],
  );

  // Swiping is never the only path: the buttons below are the primary control
  // and the arrow keys are the shortcut, so nobody has to be able to drag.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // A held-down arrow key must not fire nine swipes, and an arrow with a
      // modifier belongs to the browser (back, forward, word-jump).
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowRight") void swipe("yes");
      if (e.key === "ArrowLeft") void swipe("no");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [swipe]);

  /**
   * Answering the last card unmounts the two buttons and puts up a different
   * screen, so focus would fall to <body>. This is the one transition inside
   * the deck that replaces the screen -- a card advance does not, and is left
   * to the live region below.
   *
   * `wasDone` starts at the current value, so arriving on an already-finished
   * deck (a refresh, a second tab) moves nothing.
   */
  const done = deckSize > 0 && !quest;
  const wasDone = useRef(done);
  useEffect(() => {
    if (done && !wasDone.current) headingRef.current?.focus();
    wasDone.current = done;
  }, [done, headingRef]);

  if (deckSize === 0) {
    return (
      <section className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-5">
        <h1 ref={headingRef} tabIndex={-1} className="board text-[11px] text-accent">
          No cards yet
        </h1>
        <p className="text-center text-[15px] leading-snug text-dim">
          This room has nothing to swipe on. Give it a moment.
        </p>
      </section>
    );
  }

  if (done) {
    return (
      <section className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-5">
        <h1 ref={headingRef} tabIndex={-1} className="board text-[11px] text-accent">
          You are through the deck
        </h1>
        <p aria-live="polite" className="text-center text-[15px] leading-snug text-dim">
          {waiting.length > 0
            ? `Waiting on ${nameList(waiting)}.`
            : "Working out where you all landed…"}
        </p>
      </section>
    );
  }

  const src = photoSrc(quest);

  return (
    <section className="flex flex-col gap-5 px-5 py-8">
      <div className="flex items-baseline justify-between gap-3">
        <p className="board text-[11px] text-accent">
          <span className="num">{index + 1}</span> of <span className="num">{deckSize}</span>
        </p>
        {/* Names are not used here: `waitingOn` includes you while you are still
            swiping, and "Still swiping: you" is nonsense. Counts say the same
            thing without it. */}
        {view.members.length > 1 ? (
          <p className="text-right text-[12px] text-dim">
            <span className="num">{through}</span> of{" "}
            <span className="num">{view.members.length}</span> through
          </p>
        ) : null}
      </div>

      <article className="overflow-hidden rounded-[10px] bg-ground-raised">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element -- Places photo URLs are signed redirects, not a fixed remote pattern
          <img src={src} alt="" className="h-[200px] w-full object-cover" />
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
              {/* R68: this figure comes from a Google price level, not from the
                  venue. It is an estimate everywhere it appears. */}
              <dt className="board text-[10px] text-dim">Est. each</dt>
              <dd className="num m-0 text-[18px] text-text">{quest.priceLabel}</dd>
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
      </article>

      <p className="text-[12px] leading-snug text-dim">
        Costs are estimates, not quotes.
        {quest.source === "partner"
          ? " This card is demonstration partner inventory — no venue has signed anything."
          : null}
      </p>

      {/* The card changes under a screen reader with no other signal, because
          the two buttons persist across every card in the deck. */}
      <p aria-live="polite" className="sr-only">
        Option {index + 1} of {deckSize}: {quest.title}. About {quest.priceLabel} each,{" "}
        {quest.distanceKm} kilometres away.
      </p>

      {error ? (
        <p role="alert" className="text-[13px] leading-snug text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex gap-3">
        <Plate variant="raised" center label="Nah" disabled={busy} onClick={() => void swipe("no")} />
        <Plate variant="action" center label="I’m in" disabled={busy} onClick={() => void swipe("yes")} />
      </div>
      <p className="text-center text-[12px] text-dim">Arrow keys work too.</p>
    </section>
  );
}
