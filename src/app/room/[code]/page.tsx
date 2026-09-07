"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import { Plate } from "@/components/questly/Plate";
import { Screen, ScreenPending } from "@/components/questly/Screen";
import { errorCode, userMessage } from "@/lib/errors";
import { roomRedirect, statusTransition } from "@/lib/room";
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

/**
 * A failed deck build, carrying its code as well as its sentence.
 *
 * NO_CANDIDATES is not a fault: since the backend stopped inventing prices, a
 * $0 room in a neighbourhood where Google prices everything honestly has
 * nothing to show, and so does a 2km radius on a quiet Tuesday. That is an
 * answer to the question the room asked, and it must not be painted in the
 * same danger red as "the plan could not be written" -- nor left without the
 * one thing that would actually change it, which is a room with different
 * numbers in it.
 */
export type BuildFailure = { text: string; code: string | null };

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
  const [buildError, setBuildError] = useState<BuildFailure | null>(null);
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

  // Three different nothings, and /join is told which one it is looking at --
  // a device holding no key and a key the room refused used to land on the
  // same screen and be told the same wrong thing. The decision itself is in
  // `src/lib/room.ts`, where it can be tested; this is only the wiring.
  const answer = view === undefined ? "loading" : view === null ? "refused" : "yours";
  useEffect(() => {
    const to = roomRedirect({
      code,
      ready,
      hasKey: sessionKey !== null,
      answer,
      leaving: leaving.current,
    });
    if (to) router.replace(to);
  }, [ready, sessionKey, answer, code, router]);

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
      setBuildError({
        text: userMessage(e, "Could not build the deck. Please try again."),
        code: errorCode(e),
      });
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
    const { seen, moveFocus } = statusTransition(announced.current, status);
    announced.current = seen;
    if (moveFocus) headingRef.current?.focus();
  }, [status]);

  if (!ready || !sessionKey || view === undefined || view === null) {
    return (
      <ScreenPending label="Finding the room…" />
    );
  }

  const hostName = view.members.find((m) => m.isHost)?.name ?? "The host";

  // One route, driven entirely by room.status: the same URL is the lobby, the
  // deck, the plan and the booking, so a shared link never goes stale.
  return (
    // `bleed`: the deck is a full-bleed card surface and each of the four
    // room screens carries its own padding. The band above keeps its padding
    // either way, so the roundels stay on the same line as every other screen.
    <Screen bleed>
      {/* Under the band, not above it: the band is chrome and this is a fact
          about the room. The label the funnel puts on a seeded room must not
          vanish at the door -- inside the room is exactly where someone starts
          believing the roster, the venues and the booking are real. One place,
          so it is on the lobby, the deck, the plan and the booking alike. */}
      {view.room.demo ? (
        <p className="border-y border-hairline px-5 py-2 text-[12px] leading-snug text-dim">
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
          <p
            role="alert"
            className={`max-w-[320px] text-center text-[13px] leading-snug ${
              buildError?.code === "NO_CANDIDATES" ? "text-dim" : "text-danger"
            }`}
          >
            {buildError?.text ?? ""}
          </p>
        </section>
      ) : null}

      {view.room.status === "swiping" ? (
        <Deck
          view={view}
          code={code}
          sessionKey={sessionKey}
          headingRef={headingRef}
          setLeaving={setLeaving}
        />
      ) : null}

      {view.room.status === "matched" ? (
        <Plan view={view} code={code} sessionKey={sessionKey} headingRef={headingRef} />
      ) : null}

      {view.room.status === "booked" ? <Booked view={view} headingRef={headingRef} /> : null}
    </Screen>
  );
}
