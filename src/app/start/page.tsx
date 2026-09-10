"use client";

import { Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAction, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { PushHint } from "@/components/questly/PushHint";
import { Screen, ScreenPending } from "@/components/questly/Screen";
import { Journey } from "@/components/questly/Journey";
import { ShellNav } from "@/components/questly/ShellNav";
import { storeSessionKey } from "@/lib/room/session";
import { errorCode, userMessage } from "@/lib/errors";
import {
  EMPTY_DRAFT,
  forgetDraft,
  noDraft,
  restoredDraft,
  subscribeToDraft,
  writeDraft,
  type FunnelDraft,
  type Step,
} from "@/lib/start/funnel";
import {
  PRESET_MINUTES,
  isInThePast,
  isValidDateValue,
  minutesToInputValue,
  resolveWhenAt,
} from "@/lib/start/when";
import { Back } from "@/components/questly/icons";
import { useRedirectIfDeleting } from "@/hooks/useRedirectIfDeleting";
import { StepViews } from "./_components/StepViews";

/** Where a mis-tap goes back to. The quiz itself is answered forwards only. */
const BACK_TO: Partial<Record<Step, Step>> = { party: "mood", constraints: "party" };

/**
 * Melbourne CBD. Every room is centred here: nothing in this flow asks the
 * browser for a location, because a permission dialog mid-demo is friction
 * nobody asked for and the CBD is the right centre for this audience anyway.
 */
const CBD = { lat: -37.8136, lng: 144.9631 };

/** The sentence a time already gone gets, on the client and on the server. */
const PAST_WHEN = "That time has already passed. Pick a later time.";
const NO_WHEN_DATE = "Pick the day you want, or choose one of the three above.";
const OPEN_ROOMS_PAGE_SIZE = 8;

function StartFunnel() {
  const router = useRouter();
  const profile = useQuery(api.profiles.me, {});
  const deletion = useQuery(api.account.deletionStatus, {});
  const saveQuiz = useAction(api.profiles.saveQuiz);
  const createRoom = useMutation(api.rooms.create);
  const joinRoom = useMutation(api.rooms.join);

  /**
   * `/settings` sends somebody here to change answers they can already see.
   *
   * Without it the quiz is answered once per account and never again: the
   * resume below puts a returning host straight on the mood step, so the seven
   * cards that decide every venue score they will ever be shown were a one-way
   * door. This is the way back through it.
   */
  const retake = useSearchParams().get("retake") === "1";

  // The funnel reads a tombstoned profile's null as "has not answered the quiz",
  // so this redirect is what stops a deleted account being walked through
  // onboarding again. See the hook for the whole story.
  useRedirectIfDeleting(deletion);

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

  /**
   * A retake starts from what you said last time, not from zero.
   *
   * Slotted into the same `edited ?? … ?? EMPTY_DRAFT` chain rather than pushed
   * into state by an effect, so it needs no second render and no ref guarding a
   * one-shot write: it is simply the starting position for a retake, exactly as
   * `restored` is the starting position for a resumed sitting. The moment
   * anything is tapped `edited` takes over, and because `edit()` spreads the
   * current draft, the seeded answers carry forward with it.
   *
   * `profile` is undefined for the first render or two; until it lands there is
   * nothing to seed from and the ordinary chain applies. Nobody can have tapped
   * anything by then, so there is nothing to overwrite when it does.
   */
  const retakeSeed: FunnelDraft | null =
    retake && profile
      ? {
          ...EMPTY_DRAFT,
          step: "quiz",
          answers: profile.answers ?? {},
          goals: profile.goals ?? [],
        }
      : null;

  const draft = edited ?? retakeSeed ?? restored ?? EMPTY_DRAFT;

  /** Change one or more answers, and write the funnel down as we go. */
  function edit(patch: Partial<FunnelDraft>) {
    const next = { ...draft, ...patch };
    setEdited(next);
    writeDraft(next);
  }

  const { answers, cardIndex, goals, mood, visibility, headcount, budget, radiusKm } = draft;
  const { whenId, whenMinutes, whenDate } = draft;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A signed-out visitor can browse the whole quiz, but opening a room needs
  // an account. NOT_SIGNED_IN is the one failure this page cannot just show
  // a sentence for -- without a way onward, that sentence is a dead end.
  const [needsSignIn, setNeedsSignIn] = useState(false);

  // The draft holds the id and, if the host moved it, a time of day -- never a
  // timestamp. `resolveWhenAt` turns the pair into one at the moment the room
  // is opened, so a draft restored tomorrow gets tomorrow's "Tonight" rather
  // than yesterday's stale timestamp, and so does a page left open past
  // midnight. That second case is why this is not memoised: the old code
  // computed all three times once at mount and then handed out a dead one.
  //
  // It is also why nothing here calls `new Date()` during render. The value in
  // the time field comes from the draft alone, so the server-rendered HTML and
  // the hydrated tree cannot disagree about what time it is.
  const whenValue = minutesToInputValue(whenMinutes ?? PRESET_MINUTES[whenId]);

  // The quiz is shown once per account: a returning host lands straight on the
  // mood step -- unless they came here from `/settings` to answer it again, in
  // which case the seed above has already latched `step: "quiz"` and this does
  // not get a say.
  const resumeAt: Step | null = profile === undefined ? null : profile ? "mood" : "quiz";
  const current = draft.step ?? resumeAt;

  const lookingForRoom = current === "party" && visibility === "open";
  const openRooms = usePaginatedQuery(
    api.rooms.openRoomsPage,
    lookingForRoom && mood !== null ? { mood } : "skip",
    { initialNumItems: OPEN_ROOMS_PAGE_SIZE },
  );
  const openRoomResults = openRooms.results;
  const openRoomsStatus = openRooms.status;
  const loadMoreOpenRooms = openRooms.loadMore;

  // A page can contain only full rooms. Keep walking the native cursor until
  // there is something to show or the indexed query is exhausted.
  useEffect(() => {
    if (
      lookingForRoom &&
      openRoomResults.length === 0 &&
      openRoomsStatus === "CanLoadMore"
    ) {
      loadMoreOpenRooms(OPEN_ROOMS_PAGE_SIZE);
    }
  }, [lookingForRoom, loadMoreOpenRooms, openRoomResults.length, openRoomsStatus]);

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
    // Resolved here, against the clock as it is NOW -- not at mount, and not
    // when the chip was tapped. Somebody who sat on this screen while the hour
    // turned gets the time they are looking at, not the one they arrived with.
    // The date field is seeded when the chip is tapped, so an empty one means
    // it was cleared -- or that a draft is being resumed from a browser store
    // where the pair could have been separated. Either way the resolver would
    // quietly fall back to today, and today is not the day anyone asked for.
    if (whenId === "custom" && !isValidDateValue(whenDate)) {
      setError(NO_WHEN_DATE);
      return;
    }
    const whenAt = resolveWhenAt(whenId, whenMinutes, new Date(), whenDate);
    // The server refuses this too, and the server is the rule -- but a refusal
    // that arrives after a round trip, on a screen that has already said
    // "Opening...", is a worse way to learn you typed 6:30 when you meant
    // 18:30. This is the message; `rooms.create` is the guard.
    if (isInThePast(whenAt, Date.now())) {
      setError(PAST_WHEN);
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
        whenAt,
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
      <ScreenPending />
    );
  }

  const backTo = BACK_TO[current];

  return (
    // The first in-product screen most people see. The band's account
    // roundel matters most here: the funnel is about to write a taste profile
    // to whichever account this browser is holding, and this is where it says
    // which one that is.
    <Screen
      nav={<ShellNav route="start" />}
      /* `goals` shares the quiz's stop -- two questions in one sitting -- and
         `journeyModel` collapses them again into one stage. */
      journey={<Journey at={current === "goals" ? "quiz" : current} />}
    >
      {/* The invitation to turn notifications on, for somebody signed in.
          `/start` because the funnel ends by opening a room and there is no
          screen after it, and because `manifest.ts` sets `start_url: "/start"`
          -- an installed app launches here every time, which is the one
          placement that works on iOS, where push exists only once the app is on
          the home screen. A closed `<dialog>` occupies no space, so its
          position in this flow is not its position on screen. Guests get the
          same invitation from inside their room, where they have a seat to file
          it under. */}
      <PushHint />

      <div>
        <div className="flex flex-col gap-8">
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
            // Bordered rather than underlined, matching the vocabulary `Chip`
            // already set two steps earlier in this same funnel: 5px radius,
            // `border-dim` at rest, `--accent` on hover. An underline under a
            // tracked capital word reads as a stray link in a screen that has
            // no other links in it, and the border is what says "control".
            //
            // The arrow is the icon this product already draws for going back,
            // and its own note explains why it is an arrow and not a chevron.
            //
            // Disabled swaps the token, never the opacity -- the same rule
            // `Plate.tsx` states, which this control is not exempt from. This
            // sits on `--ground` (`Screen`'s frame is `bg-ground`), so
            // `disabled:opacity-50` composited --accent over it: 2.49:1 dark,
            // 2.63:1 light, both under the 4.5:1 this project does not waive for
            // disabled controls. `--text-dim` is 5.26:1 dark and 6.21:1 light,
            // and it is the tone the rest of the funnel already uses for "not
            // right now".
            className="board flex min-h-[44px] min-w-[44px] items-center gap-2 self-start rounded-[5px] border border-dim px-4 text-[11px] text-accent transition-colors hover:border-accent disabled:pointer-events-none disabled:text-dim"
          >
            <Back className="size-[14px]" aria-hidden />
            Back
          </button>
        ) : null}

          <StepViews
            current={current}
            headingRef={headingRef}
            cardIndex={cardIndex}
            answers={answers}
            goals={goals}
            mood={mood}
            visibility={visibility}
            headcount={headcount}
            budget={budget}
            whenId={whenId}
            whenValue={whenValue}
            whenDate={whenDate}
            radiusKm={radiusKm}
            busy={busy}
            lookingForRoom={lookingForRoom}
            openRooms={openRooms}
            edit={edit}
            goTo={goTo}
            toggleGoal={toggleGoal}
            finishQuiz={finishQuiz}
            openTheRoom={openTheRoom}
            joinOpenRoom={joinOpenRoom}
          />
        </div>
      </div>
    </Screen>
  );
}

/**
 * `useSearchParams` client-side renders the tree up to the nearest Suspense
 * boundary, so the funnel gets one of its own -- the same shape `/sign-in` and
 * `/join/[code]` already use for the same reason.
 */
export default function StartPage() {
  return (
    <Suspense>
      <StartFunnel />
    </Suspense>
  );
}
