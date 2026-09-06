"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import { Plate } from "@/components/questly/Plate";
import { userMessage } from "@/lib/errors";
import { useSessionKey } from "@/lib/session";
import { Lobby } from "./Lobby";
import { Deck } from "./Deck";
import { Plan } from "./Plan";
import { Booked } from "./Booked";

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
  const build = useAction(api.deck.build);

  /**
   * The build failure lives HERE, not in the Lobby, because the Lobby does not
   * survive long enough to show it.
   *
   * `deck.markBuilding` commits `status: "building"` within milliseconds, which
   * unmounts <Lobby> below. The build's real failures -- NO_CANDIDATES above
   * all, the likeliest one in a live demo -- arrive seconds after that, by
   * which time `abandonBuild` has returned the room to the lobby and a BRAND
   * NEW <Lobby> has mounted with its own empty error state. The host saw a
   * flash and silence, and tapped again, spending Places and OpenAI quota on
   * the same failure. This shell stays mounted across all of it.
   */
  const [buildError, setBuildError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  /**
   * A member who deliberately leaves must not be sent back to /join.
   *
   * Leaving deletes their member row, so `rooms.get` returns null in the same
   * breath -- indistinguishable, to the redirect below, from a stale key. A ref
   * rather than state: it only ever suppresses a redirect, so it must not
   * itself cause a render, and the Lobby clears it again if the mutation fails.
   */
  const leaving = useRef(false);
  const setLeaving = useCallback((value: boolean) => {
    leaving.current = value;
  }, []);

  // Two different nothings. `ready` is false until the session store has
  // actually been read, and redirecting before then bounces every visitor to
  // /join on their first render -- including the ones who are already members.
  // `view === null` is the room itself saying it does not recognise this key.
  useEffect(() => {
    if (leaving.current) return;
    if ((ready && !sessionKey) || view === null) router.replace(`/join/${code}`);
  }, [ready, sessionKey, view, code, router]);

  /**
   * The recovery the backend already built, finally reachable.
   *
   * `deck.build` explicitly permits `status === "building"` "so a build that
   * died halfway can be retried", and `markBuilding` refuses to hand over the
   * claim until it is two minutes stale. So this is honest at both ends: press
   * it early and the room says "give it a moment"; press it after the claim has
   * gone stale -- a deploy, a timeout, a crash, the cases whose error handler
   * never runs -- and it genuinely rebuilds. Deliberately NOT on a timer: this
   * spends Places and OpenAI quota, so it stays behind a tap.
   */
  async function retryTheBuild() {
    // A guard rather than `disabled` on the button being pressed: disabling a
    // focused control hands focus back to <body>, and this is the only control
    // on the screen.
    if (!sessionKey || retrying) return;
    setRetrying(true);
    setBuildError(null);
    try {
      await build({ code, sessionKey });
    } catch (e) {
      setBuildError(userMessage(e, "Could not build the deck. Please try again."));
    } finally {
      setRetrying(false);
    }
  }

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

  const hostName = view.members.find((m) => m.isHost)?.name ?? "The host";

  // One route, driven entirely by room.status: the same URL is the lobby, the
  // deck, the plan and the booking, so a shared link never goes stale.
  return (
    <main className="mx-auto w-full max-w-[460px] flex-1 bg-ground">
      {/* The label the funnel puts on a seeded room must not vanish at the
          door -- inside the room is exactly where someone starts believing the
          roster, the venues and the booking are real. One place, so it is on
          the lobby, the deck, the plan and the booking alike. */}
      {view.room.demo ? (
        <p className="border-b border-hairline px-5 py-2 text-[12px] leading-snug text-dim">
          Demonstration room. The people and the places in here are seeded examples — nobody
          is really waiting, no venue has agreed to anything, and any booking is simulated.
        </p>
      ) : null}

      {view.room.status === "lobby" ? (
        <Lobby
          view={view}
          code={code}
          sessionKey={sessionKey}
          headingRef={headingRef}
          buildError={buildError}
          setBuildError={setBuildError}
          setLeaving={setLeaving}
        />
      ) : null}

      {view.room.status === "building" ? (
        <section className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-5">
          <h1 ref={headingRef} tabIndex={-1} className="board text-[11px] text-accent">
            Building the deck
          </h1>
          <p className="text-center text-[15px] leading-snug text-dim">
            Nine places, ranked against your budget and how far you will go.
          </p>

          {/* Never a dead end. Without a control here, a build that was killed
              outright leaves every member -- host included -- on this screen
              forever, and a reload re-renders the same dead screen. */}
          {view.you.isHost ? (
            <Plate
              variant="ghost"
              center
              className="mt-2 max-w-[320px]"
              label={retrying ? "Trying again…" : "Build it again"}
              sub="Only if this has been sitting here a couple of minutes."
              onClick={() => void retryTheBuild()}
            />
          ) : (
            // No button for a non-host: `deck.build` is host-only, so offering
            // one here would only ever be refused.
            <p className="text-center text-[13px] leading-snug text-dim">
              If this sits here, {hostName} can start it again.
            </p>
          )}

          {/* Mounted with the screen and empty, so the sentence that arrives in
              it later is actually announced. */}
          <p role="alert" className="max-w-[320px] text-center text-[13px] leading-snug text-danger">
            {buildError ?? ""}
          </p>
        </section>
      ) : null}

      {view.room.status === "swiping" ? (
        <Deck view={view} code={code} sessionKey={sessionKey} headingRef={headingRef} />
      ) : null}

      {view.room.status === "matched" ? (
        <Plan view={view} code={code} sessionKey={sessionKey} headingRef={headingRef} />
      ) : null}

      {view.room.status === "booked" ? <Booked view={view} headingRef={headingRef} /> : null}
    </main>
  );
}
