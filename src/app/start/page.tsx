"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { QUIZ_CARDS, QUIZ_GOALS } from "@convex/lib/quiz";
import type { Mood } from "@convex/lib/scoring";
import { Plate } from "@/components/questly/Plate";
import { Chip } from "@/components/questly/Chip";
import { ThemeToggle } from "@/components/questly/theme";
import { storeSessionKey } from "@/lib/session";
import { errorCode, userMessage } from "@/lib/errors";
import {
  BUDGETS,
  EMPTY_DRAFT,
  HEADCOUNTS,
  RADII,
  forgetDraft,
  noDraft,
  restoredDraft,
  subscribeToDraft,
  writeDraft,
  type FunnelDraft,
  type Step,
} from "@/lib/funnel";

const MOODS: Array<{ id: Mood; label: string; sub: string }> = [
  { id: "grass", label: "Touch grass", sub: "Outside, free, no booking needed." },
  { id: "meet", label: "Meet people", sub: "Rooms with strangers who showed up too." },
  { id: "treat", label: "Treat yourself", sub: "One good thing, properly." },
  { id: "new", label: "Do something new", sub: "Something you have not done before." },
];

/**
 * The seven more/less cards plus the goals question. The board line says
 * "question", not "card", because the eighth one is not a card to react to and
 * a counter that says otherwise is a small lie on the first screen anyone sees.
 */
const TOTAL_QUESTIONS = QUIZ_CARDS.length + 1;

/** Where a mis-tap goes back to. The quiz itself is answered forwards only. */
const BACK_TO: Partial<Record<Step, Step>> = { party: "mood", constraints: "party" };

/**
 * Melbourne CBD. Every room is centred here: nothing in this flow asks the
 * browser for a location, because a permission dialog mid-demo is friction
 * nobody asked for and the CBD is the right centre for this audience anyway.
 */
const CBD = { lat: -37.8136, lng: 144.9631 };

/** Tonight 6:30pm, tomorrow 6:30pm, Saturday 2pm -- in the user's own clock. */
function whenOptions(): Array<{ id: string; label: string; at: number }> {
  const at = (dayOffset: number, hour: number, minute: number) => {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, minute, 0, 0);
    return d.getTime();
  };
  const today = new Date().getDay();
  const untilSaturday = (6 - today + 7) % 7 || 7;
  return [
    { id: "tonight", label: "Tonight", at: at(0, 18, 30) },
    { id: "tomorrow", label: "Tomorrow", at: at(1, 18, 30) },
    { id: "weekend", label: "This weekend", at: at(untilSaturday, 14, 0) },
  ];
}

/**
 * When an open room is meeting. A clock face alone cannot separate tonight
 * 6:30pm from Saturday 2pm, and the difference is the whole commitment -- so
 * the weekday goes in front of the time for anything that is not today. Today
 * keeps the bare time: "Sat" on a room happening in four hours would be noise.
 */
function roomWhenLabel(at: number): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
  const now = new Date();
  const today =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return today ? time : `${d.toLocaleDateString("en-AU", { weekday: "short" })} ${time}`;
}

export default function StartPage() {
  const router = useRouter();
  const profile = useQuery(api.profiles.me, {});
  const saveQuiz = useAction(api.profiles.saveQuiz);
  const createRoom = useMutation(api.rooms.create);
  const joinRoom = useMutation(api.rooms.join);

  /**
   * The whole funnel in one value, and the reason a sign-in round trip no
   * longer costs twelve taps.
   *
   * `restoredDraft` is read once, on the client only, and frozen; `noDraft`
   * is what the server and the hydration render see, so the first paint is
   * identical on both sides and there is no effect syncing a browser store
   * into state. `edited` takes over the moment anything is tapped, so the
   * restore point is a starting position rather than a store this page has to
   * stay in sync with.
   */
  const restored = useSyncExternalStore(subscribeToDraft, restoredDraft, noDraft);
  const [edited, setEdited] = useState<FunnelDraft | null>(null);
  const draft = edited ?? restored ?? EMPTY_DRAFT;

  /** Change one or more answers, and write the funnel down as we go. */
  function edit(patch: Partial<FunnelDraft>) {
    const next = { ...draft, ...patch };
    setEdited(next);
    writeDraft(next);
  }

  const { answers, cardIndex, goals, mood, visibility, headcount, budget, radiusKm } = draft;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A signed-out visitor can browse the whole quiz, but opening a room needs
  // an account. NOT_SIGNED_IN is the one failure this page cannot just show
  // a sentence for -- without a way onward, that sentence is a dead end.
  const [needsSignIn, setNeedsSignIn] = useState(false);

  // One source for the three times on offer. The draft holds the id, never a
  // second copy of the option, so the timestamp sent to the server is always
  // the one rendered next to the label -- and a draft restored tomorrow gets
  // tomorrow's "Tonight", not yesterday's stale timestamp.
  const whens = useMemo(() => whenOptions(), []);
  const when = whens.find((w) => w.id === draft.whenId) ?? whens[0];

  // The quiz is shown once per account and never again: a returning host lands
  // straight on the mood step.
  const resumeAt: Step | null = profile === undefined ? null : profile ? "mood" : "quiz";
  const current = draft.step ?? resumeAt;

  const lookingForRoom = current === "party" && visibility === "open";
  const openRooms = useQuery(
    api.rooms.openRooms,
    lookingForRoom && mood !== null ? { mood } : "skip",
  );

  /**
   * A step change swaps the whole <section> out, unmounting the control that
   * was just pressed: focus falls to <body> and a screen reader is told
   * nothing happened. Moving focus to the new <h1> fixes both at once (WCAG
   * 2.4.3), which is also why there is no aria-live wrapper around the
   * sections -- a focused heading is already announced, and both together
   * would say it twice.
   *
   * Keyed on `current` alone, not `cardIndex`: advancing a quiz card unmounts
   * nothing (the `<h1>` and both answer plates persist across all seven
   * cards), and the card's question text already carries `aria-live="polite"`,
   * which announces the change on its own. Including `cardIndex` here pulled
   * focus off the very button the user was repeatedly pressing, on every one
   * of the seven cards. The last card's advance to "goals" still moves focus
   * -- that transition changes `current`, which does swap the screen.
   */
  const headingRef = useRef<HTMLHeadingElement>(null);
  const announced = useRef<string | null>(null);
  useEffect(() => {
    // Nothing to focus while `profiles.me` is still in flight -- the page is
    // on the `Loading…` branch and no heading is mounted.
    if (current === null) return;
    // Same step as last time: a re-run that moved nothing, so move nothing.
    // (Strict Mode double-invokes mount effects; this is what stops that
    // second pass from stealing focus on arrival.)
    if (announced.current === current) return;
    const arriving = announced.current === null;
    announced.current = current;
    // The first screen is the page arriving, not a step change. Grabbing focus
    // there would cut across the browser's own announcement of a freshly
    // loaded document.
    if (!arriving) headingRef.current?.focus();
  }, [current]);

  /**
   * Every step change goes through here. `error` describes the step it was
   * raised on -- "This room has already started" belongs to the room list, not
   * to "What kind of night?" -- so leaving a step retires its error.
   */
  function goTo(next: Step, patch: Partial<FunnelDraft> = {}) {
    setError(null);
    setNeedsSignIn(false);
    edit({ ...patch, step: next });
  }

  function toggleGoal(id: string) {
    // Multi-select: leaving with a new name in your phone and coming back
    // calmer are not mutually exclusive.
    edit({
      goals: goals.includes(id) ? goals.filter((g) => g !== id) : [...goals, id],
    });
  }

  /**
   * Store the quiz answers against the account, when there is one.
   *
   * Two failures, and they are not the same failure. NOT_SIGNED_IN is a KNOWN
   * STATE, not an error: a signed-out visitor is allowed to browse the whole
   * quiz, and the answers ride the draft through sign-in and are stored on the
   * way back (see `openTheRoom`). Anything else is a degraded embedding, which
   * must not block the night -- the room works without it, only the
   * recommendations get blunter -- so it is logged and stepped over, and
   * `quizSaved` records that it did not happen.
   *
   * Returns whether the answers are now stored.
   */
  async function storeTheQuiz(): Promise<boolean> {
    try {
      // No displayName: the server refuses one and derives the name from the
      // authenticated identity instead. Goals are required and validated
      // against GOAL_IDS, so only ids from QUIZ_GOALS may be sent.
      await saveQuiz({ answers, goals });
      return true;
    } catch (e) {
      if (errorCode(e) !== "NOT_SIGNED_IN") {
        console.warn("saveQuiz failed; continuing without a taste vector", e);
      }
      return false;
    }
  }

  async function finishQuiz() {
    setBusy(true);
    setError(null);
    const quizSaved = await storeTheQuiz();
    setBusy(false);
    goTo("mood", { quizSaved });
  }

  async function openTheRoom() {
    // The only route to this step runs through the mood picker, so `mood` is
    // set by the time this can be pressed. Sending them back is still better
    // than an assertion that says it cannot happen: if it ever does, the
    // screen that asks the question is one tap away.
    if (mood === null) {
      goTo("mood");
      return;
    }
    setBusy(true);
    setError(null);
    setNeedsSignIn(false);
    try {
      // The other half of the round trip. A visitor who answered the quiz
      // signed out reaches here with `quizSaved: false` and, by now, an
      // identity -- so the answers they gave before signing in finally reach
      // their profile instead of being quietly thrown away.
      if (!draft.quizSaved && Object.keys(answers).length > 0) {
        if (await storeTheQuiz()) edit({ quizSaved: true });
      }
      const { code, sessionKey } = await createRoom({
        mood,
        headcount,
        budgetPerHeadCents: budget,
        whenAt: when.at,
        centreLat: CBD.lat,
        centreLng: CBD.lng,
        radiusKm,
        visibility,
        hostName: profile?.displayName ?? "Host",
      });
      storeSessionKey(code, sessionKey);
      // The funnel has become a room. Nothing left to restore.
      forgetDraft();
      router.push(`/room/${code}`);
    } catch (e) {
      setError(userMessage(e, "Could not open the room. Please try again."));
      setNeedsSignIn(errorCode(e) === "NOT_SIGNED_IN");
      setBusy(false);
    }
  }

  async function joinOpenRoom(code: string) {
    setBusy(true);
    setError(null);
    setNeedsSignIn(false);
    try {
      const joined = await joinRoom({ code, name: profile?.displayName ?? "Someone" });
      storeSessionKey(joined.code, joined.sessionKey);
      forgetDraft();
      router.push(`/room/${joined.code}`);
    } catch (e) {
      setError(userMessage(e, "Could not join that room. Please try again."));
      setNeedsSignIn(errorCode(e) === "NOT_SIGNED_IN");
      setBusy(false);
    }
  }

  if (current === null) {
    return (
      <main className="flex flex-1 items-center justify-center bg-ground">
        <p className="board text-[11px] text-accent">Loading…</p>
      </main>
    );
  }

  const backTo = BACK_TO[current];

  return (
    <main className="mx-auto flex w-full max-w-[460px] flex-1 flex-col gap-8 bg-ground px-5 py-10">
      {/* The first in-product screen most people see, and until now the whole
          product had no way to reach the day palette from inside itself. */}
      <div className="flex items-start justify-between gap-3">
        <p className="board text-[11px] text-accent">Questly</p>
        <ThemeToggle />
      </div>

      {/* Always mounted, filled when something is refused: a live region
          inserted into the DOM with its text already in it is frequently never
          announced. `empty:-mb-8` takes back the flex gap an empty paragraph
          would otherwise leave at the top of every step -- `display: none`
          would take it out of the accessibility tree and be no better than not
          rendering it at all. */}
      <p role="alert" className="text-[13px] text-danger empty:-mb-8">
        {error ?? ""}
        {error && needsSignIn ? (
          <>
            {" "}
            {/* Carries the funnel's own URL, so signing in comes back to the
                twelve answers already given rather than to the top. */}
            <Link href="/sign-in?redirect=%2Fstart" className="text-text underline underline-offset-4">
              Sign in
            </Link>{" "}
            to open a room.
          </>
        ) : null}
      </p>

      {/* Mood and party are single-tap decisions with no confirm, so a mis-tap
          otherwise strands you: nothing later in the flow returns to them. */}
      {backTo ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => goTo(backTo)}
          // `self-start` shrinks this to its content width, and "BACK" at 11px
          // is nowhere near the 44px target floor this project holds itself
          // to. The padding is what makes the target, not the label.
          //
          // Disabled swaps the token, never the opacity -- the same rule
          // `Plate.tsx` states, which this control is not exempt from. This
          // sits on `--ground` (the `<main>` above is `bg-ground`), so
          // `disabled:opacity-50` composited --accent over it: 2.49:1 dark,
          // 2.63:1 light, both under the 4.5:1 this project does not waive for
          // disabled controls. `--text-dim` is 5.26:1 dark and 6.21:1 light,
          // and it is the tone the rest of the funnel already uses for "not
          // right now".
          className="board min-h-[44px] min-w-[44px] self-start px-4 text-[11px] text-accent underline underline-offset-4 disabled:pointer-events-none disabled:text-dim"
        >
          Back
        </button>
      ) : null}

      {current === "quiz" ? (
        <section aria-labelledby="quiz-heading" className="flex flex-col gap-6">
          <div>
            <p className="board text-[11px] text-accent">
              Question <span className="num">{cardIndex + 1}</span> of{" "}
              <span className="num">{TOTAL_QUESTIONS}</span>
            </p>
            <h1
              id="quiz-heading"
              ref={headingRef}
              tabIndex={-1}
              className="display mt-3 text-[34px] text-text"
            >
              More likely, or less likely?
            </h1>
          </div>

          {/* The heading never changes, only the card does -- so the card is
              what gets announced when it turns over. */}
          <p aria-live="polite" className="text-[19px] leading-snug text-text">
            {QUIZ_CARDS[cardIndex].text}
          </p>

          <div className="flex flex-col gap-2">
            {/* Both answers are raised. An orange plate on "More likely" puts
                the house thumb on a preference instrument, and only the "more"
                answers reach the embedding (convex/lib/quiz.ts), so the bias
                would ride into every recommendation that follows. */}
            {(["more", "less"] as const).map((dir) => (
              <Plate
                key={dir}
                variant="raised"
                label={dir === "more" ? "More likely" : "Less likely"}
                onClick={() => {
                  const answered = { ...answers, [QUIZ_CARDS[cardIndex].id]: dir };
                  if (cardIndex + 1 < QUIZ_CARDS.length) {
                    // Latch the step on the first answer. Until it is latched,
                    // `current` is derived live from the `profiles.me`
                    // subscription -- so a profile arriving mid-quiz (a second
                    // tab finishing it) would swap this screen for the mood
                    // picker and throw away every answer given so far.
                    edit({ answers: answered, step: "quiz", cardIndex: cardIndex + 1 });
                  } else goTo("goals", { answers: answered });
                }}
              />
            ))}
          </div>
        </section>
      ) : null}

      {current === "goals" ? (
        <section aria-labelledby="goals-heading" className="flex flex-col gap-6">
          <div>
            <p className="board text-[11px] text-accent">
              Question <span className="num">{TOTAL_QUESTIONS}</span> of{" "}
              <span className="num">{TOTAL_QUESTIONS}</span>
            </p>
            <h1
              id="goals-heading"
              ref={headingRef}
              tabIndex={-1}
              className="display mt-3 text-[34px] text-text"
            >
              What is the night for?
            </h1>
          </div>

          <fieldset className="flex flex-col gap-3 border-0 p-0">
            <legend className="board text-[11px] text-accent">Pick as many as are true</legend>
            <div className="flex flex-wrap gap-2">
              {QUIZ_GOALS.map((goal) => (
                <Chip
                  key={goal.id}
                  face="prose"
                  selected={goals.includes(goal.id)}
                  onClick={() => toggleGoal(goal.id)}
                >
                  {goal.text}
                </Chip>
              ))}
            </div>
          </fieldset>

          <p className="text-[12px] leading-snug text-dim">
            These shape what we suggest. Picking none is a fine answer — the seven
            cards already said plenty.
          </p>

          <Plate
            variant="action"
            label={
              busy
                ? "Working it out…"
                : goals.length === 0
                  ? "Nothing in particular"
                  : "That is the night"
            }
            disabled={busy}
            onClick={() => void finishQuiz()}
          />
        </section>
      ) : null}

      {current === "mood" ? (
        <section aria-labelledby="mood-heading" className="flex flex-col gap-6">
          <h1
            id="mood-heading"
            ref={headingRef}
            tabIndex={-1}
            className="display text-[38px] text-text"
          >
            What kind of night?
          </h1>
          <div className="flex flex-col gap-2">
            {/* All four raised until one is tapped, and the chosen one carries
                a ring plus `aria-pressed` -- never a fill colour alone. */}
            {MOODS.map((m) => (
              <Plate
                key={m.id}
                variant="raised"
                selected={m.id === mood}
                label={m.label}
                sub={m.sub}
                onClick={() =>
                  // "Meet people" is the one mood whose entire point is strangers.
                  goTo("party", {
                    mood: m.id,
                    visibility: m.id === "meet" ? "open" : "private",
                  })
                }
              />
            ))}
          </div>
        </section>
      ) : null}

      {current === "party" ? (
        <section aria-labelledby="party-heading" className="flex flex-col gap-6">
          <h1
            id="party-heading"
            ref={headingRef}
            tabIndex={-1}
            className="display text-[38px] text-text"
          >
            Who is coming?
          </h1>

          {/* `disabled={busy}` on all three: a tap on a room below starts a
              join, and without this a tap here during that flight renders the
              constraints step just before router.push drags them into the
              room they half-chose. */}
          <div className="flex flex-col gap-2">
            <Plate
              variant="raised"
              label="With friends"
              sub="Open a room and send them the number."
              disabled={busy}
              onClick={() => goTo("constraints", { visibility: "private" })}
            />
            <Plate
              variant="raised"
              label="Just me"
              sub="A solo sidequest. Same plan, no voting."
              disabled={busy}
              onClick={() => goTo("constraints", { visibility: "private", headcount: 1 })}
            />
            <Plate
              variant="raised"
              selected={visibility === "open"}
              label="Meet people"
              sub="Join a room that is already open."
              disabled={busy}
              onClick={() => edit({ visibility: "open" })}
            />
          </div>

          {/* Tapping "Meet people" leaves all three Plates mounted and reveals
              a list underneath them. Nothing is unmounted, so focus correctly
              does not move -- which leaves a live region as the only thing
              that can say anything happened, and until now there was none.
              Mounted with the section and empty, because a region inserted
              into the DOM with its text already inside it announces nothing.
              `sr-only` is absolutely positioned, so it costs no layout. */}
          <p aria-live="polite" className="sr-only">
            {!lookingForRoom
              ? ""
              : openRooms === undefined
                ? "Looking for open rooms."
                : openRooms.length === 0
                  ? "No rooms are open for this mood yet. You can open one others can join."
                  : `${openRooms.length} open ${openRooms.length === 1 ? "room" : "rooms"} for this mood.`}
          </p>

          {lookingForRoom ? (
            <div className="flex flex-col gap-2">
              <h2 className="board text-[11px] text-accent">Open rooms right now</h2>
              {openRooms === undefined ? (
                <p className="text-[13px] text-dim">Looking…</p>
              ) : (
                <>
                  {openRooms.length === 0 ? (
                    <p className="text-[13px] text-dim">
                      Nobody has a room open for this mood yet.
                    </p>
                  ) : (
                    <>
                      {openRooms.map((room) => (
                        <Plate
                          key={room.code}
                          variant="raised"
                          label={`Room ${room.code}`}
                          sub={
                            room.demo
                              ? `Demonstration room · ${room.memberCount} of ${room.headcount} in`
                              : `${room.memberCount} of ${room.headcount} in`
                          }
                          right={roomWhenLabel(room.whenAt)}
                          disabled={busy}
                          onClick={() => void joinOpenRoom(room.code)}
                        />
                      ))}
                      {openRooms.some((room) => room.demo) ? (
                        <p className="text-[12px] leading-snug text-dim">
                          Rooms marked as demonstration rooms are seeded examples, not
                          other people waiting.
                        </p>
                      ) : null}
                    </>
                  )}

                  {/* Below the list as well as instead of it. Four seeded
                      demonstration rooms mean the empty branch is never taken
                      on a seeded deployment, so hiding this control there made
                      an open room something no real user could ever create --
                      and the open-rooms pool something only the seed could
                      fill. `visibility` is already "open" whenever this
                      renders (that is what `lookingForRoom` means), so it is
                      an open room that gets created. */}
                  <Plate
                    variant="action"
                    label={
                      openRooms.length === 0
                        ? "Open one others can join"
                        : "Open your own instead"
                    }
                    sub={
                      openRooms.length === 0
                        ? undefined
                        : "It joins this list, so strangers can find it too."
                    }
                    disabled={busy}
                    onClick={() => goTo("constraints")}
                  />
                </>
              )}
            </div>
          ) : null}
        </section>
      ) : null}

      {current === "constraints" ? (
        <section aria-labelledby="constraints-heading" className="flex flex-col gap-7">
          <h1
            id="constraints-heading"
            ref={headingRef}
            tabIndex={-1}
            className="display text-[38px] text-text"
          >
            Four answers and it is solved.
          </h1>

          <fieldset className="flex flex-col gap-3 border-0 p-0">
            <legend className="board text-[11px] text-accent">How many</legend>
            <div className="flex flex-wrap gap-2">
              {/* Six, not "6+". Nothing downstream honours a plus: the room is
                  costed and sized for the number sent, and joins are capped at
                  MAX_ROOM_MEMBERS regardless. A label that promises more than
                  the number does is a small lie about what was booked. */}
              {HEADCOUNTS.map((n) => (
                <Chip key={n} selected={headcount === n} onClick={() => edit({ headcount: n })}>
                  {n === 1 ? "Just me" : n}
                </Chip>
              ))}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-3 border-0 p-0">
            <legend className="board text-[11px] text-accent">Budget per head</legend>
            <div className="flex flex-wrap gap-2">
              {BUDGETS.map((cents) => (
                <Chip key={cents} selected={budget === cents} onClick={() => edit({ budget: cents })}>
                  {cents === 0 ? "$0" : `$${cents / 100}`}
                </Chip>
              ))}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-3 border-0 p-0">
            <legend className="board text-[11px] text-accent">When</legend>
            <div className="flex flex-wrap gap-2">
              {whens.map((w) => (
                <Chip key={w.id} selected={when.id === w.id} onClick={() => edit({ whenId: w.id })}>
                  {w.label}
                </Chip>
              ))}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-3 border-0 p-0">
            <legend className="board text-[11px] text-accent">How far</legend>
            <div className="flex flex-wrap gap-2">
              {RADII.map((km) => (
                <Chip key={km} selected={radiusKm === km} onClick={() => edit({ radiusKm: km })}>
                  {km} km
                </Chip>
              ))}
            </div>
            <p className="text-[12px] text-dim">Measured from the Melbourne CBD.</p>
          </fieldset>

          <Plate
            variant="action"
            label={busy ? "Opening…" : "Open the room"}
            disabled={busy}
            onClick={() => void openTheRoom()}
          />
        </section>
      ) : null}
    </main>
  );
}
