"use client";

import { use, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import { useSessionKey } from "@/lib/session";
import { Lobby } from "./Lobby";
import { Deck } from "./Deck";

/**
 * The shape every screen in the room is written against.
 *
 * Derived from the query rather than restated, so the day `rooms.get` changes
 * its projection the screens stop compiling instead of quietly rendering a
 * field that is no longer there. `NonNullable` because null is not a room --
 * it is "I do not know you here", which the page below turns into a redirect.
 */
export type RoomView = NonNullable<FunctionReturnType<typeof api.rooms.get>>;

export default function RoomPage({ params }: PageProps<"/room/[code]">) {
  const { code } = use(params);
  const router = useRouter();
  const { sessionKey, ready } = useSessionKey(code);

  // One subscription for the whole room. Roster, deck, swipe progress, match,
  // plan, proposals and booking all arrive here, so nothing below polls.
  const view = useQuery(api.rooms.get, sessionKey ? { code, sessionKey } : "skip");

  // Two different nothings. `ready` is false until the session store has
  // actually been read, and redirecting before then bounces every visitor to
  // /join on their first render -- including the ones who are already members.
  // `view === null` is the room itself saying it does not recognise this key.
  useEffect(() => {
    if ((ready && !sessionKey) || view === null) router.replace(`/join/${code}`);
  }, [ready, sessionKey, view, code, router]);

  /**
   * One focus policy for the whole room, in one place.
   *
   * Four of the room's transitions REPLACE the screen -- lobby to deck, deck to
   * match, plan to booking -- and each unmounts the control that was just
   * pressed. Focus falls to <body> and a keyboard user re-Tabs from the top of
   * the document, so focus moves to the new screen's heading (WCAG 2.4.3).
   *
   * Keyed on `status` alone. A card advancing inside the deck changes nothing
   * about the screen's structure: the buttons persist, a live region announces
   * the new card, and pulling focus off the button someone is repeatedly
   * pressing would be worse than doing nothing. The first status this page sees
   * is the page arriving, not a transition, so it moves nothing.
   */
  const headingRef = useRef<HTMLHeadingElement>(null);
  const announced = useRef<string | null>(null);
  const status = view?.room.status ?? null;
  useEffect(() => {
    if (status === null) return;
    if (announced.current === status) return;
    const arriving = announced.current === null;
    announced.current = status;
    if (!arriving) headingRef.current?.focus();
  }, [status]);

  if (!ready || !sessionKey || view === undefined || view === null) {
    return (
      <main className="flex flex-1 items-center justify-center bg-ground">
        <p className="board text-[11px] text-accent">Finding the room…</p>
      </main>
    );
  }

  // One route, driven entirely by room.status: the same URL is the lobby, the
  // deck, the plan and the booking, so a shared link never goes stale.
  return (
    <main className="mx-auto w-full max-w-[460px] flex-1 bg-ground">
      {view.room.status === "lobby" ? (
        <Lobby view={view} code={code} sessionKey={sessionKey} headingRef={headingRef} />
      ) : null}

      {view.room.status === "building" ? (
        <section className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-5">
          <h1 ref={headingRef} tabIndex={-1} className="board text-[11px] text-accent">
            Building the deck
          </h1>
          <p className="text-center text-[15px] leading-snug text-dim">
            Nine places, ranked against your budget and how far you will go.
          </p>
        </section>
      ) : null}

      {view.room.status === "swiping" ? (
        <Deck view={view} code={code} sessionKey={sessionKey} headingRef={headingRef} />
      ) : null}

      {view.room.status === "matched" || view.room.status === "booked" ? (
        <section className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-5">
          <h1 ref={headingRef} tabIndex={-1} className="board flap text-[11px] text-accent">
            It&rsquo;s a match
          </h1>
          <p className="text-center text-[15px] leading-snug text-dim">Writing the plan…</p>
        </section>
      ) : null}
    </main>
  );
}
