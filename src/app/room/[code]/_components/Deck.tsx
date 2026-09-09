"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";
import { useFocusOnArrival } from "@/hooks/useFocusOnArrival";
import { useInFlight } from "@/hooks/useInFlight";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { AnimatePresence } from "motion/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ConfirmButton } from "@/components/questly/ConfirmButton";
import { Plate } from "@/components/questly/Plate";
import { useCountdown } from "@/hooks/useCountdown";
import { useNow } from "@/hooks/useNow";
import { photoSrc } from "@/lib/room/photo";
import { venueMapsUrl } from "@/lib/room/maps";
import { userMessage } from "@/lib/errors";
import { OutLink } from "./OutLink";
import { SwipeCard } from "./SwipeCard";
import type { RoomView } from "../page";

/**
 * Where a Places photo is fetched from. The card stores Google's opaque photo
 * name, never a media URL, and this endpoint attaches the key inside the
 * deployment -- so no API key of ours ever reaches the browser.
 *
 * The URL itself is built in `src/lib/photo.ts`, not here, because the query
 * string it produces is a contract with a validator-less `httpAction` that no
 * type checker can see across. `src/lib/photo.test.ts` drives the real handler
 * with a request built by that function, so the two ends fail together.
 */
const CONVEX_SITE = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;

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
  setLeaving,
}: {
  view: RoomView;
  code: string;
  sessionKey: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  /** Tells the shell not to bounce a departing member back to /join. */
  setLeaving: (value: boolean) => void;
}) {
  const router = useRouter();
  const cast = useMutation(api.swipes.cast);
  const removeMember = useMutation(api.rooms.removeMember);
  const leaveRoom = useMutation(api.rooms.leave);
  // One swipe at a time. A ref and not `disabled` on the two plates below: see
  // `useInFlight`, which was written out of what this screen cost.
  const run = useInFlight();
  const [error, setError] = useState<string | null>(null);

  /**
   * Which plate the live drag is heading toward.
   *
   * This is the whole yes/no affordance. The card grows no stamp and no
   * coloured glow: the CONTROL lights up instead, using `Plate`'s existing
   * `selected` ring rather than a treatment invented for this one screen. Two
   * things fall out of that. The deck speaks the same dialect as every chip and
   * plate elsewhere in the product, and the gesture teaches itself -- the first
   * drag shows you that dragging right IS the "I'm in" button.
   */
  const [lean, setLean] = useState<"yes" | "no" | null>(null);

  // R34: your position in the deck is YOUR swipe count, never a shared cursor.
  // Two people swipe at different speeds, and a shared index would show one of
  // them a card they had already answered.
  const index = view.progress.swipedByYou;
  const quest = view.quests[index];
  const deckSize = view.quests.length;
  const waiting = view.progress.waitingOn;
  const through = view.members.length - waiting.length;
  const hostName = view.members.find((m) => m.isHost)?.name ?? "The host";

  /**
   * The two escape hatches the backend already built for a room that cannot
   * finish, finally reachable from the screen where the jam shows up.
   *
   * Both return where focus should go: "gone" when this control's own screen
   * has been replaced (the roster shrinks and the deck resolves, or the leaver
   * is routed away), "trigger" when the action was refused and the control is
   * still on screen. See ConfirmButton.
   */
  async function remove(memberId: Id<"members">): Promise<"trigger" | "gone"> {
    setError(null);
    try {
      await removeMember({ code, sessionKey, memberId });
      // Their row and the button naming it both went; the heading is the top
      // of the screen the control belonged to, and focus has to land on
      // something real rather than on <body>.
      headingRef.current?.focus();
      return "gone";
    } catch (e) {
      setError(userMessage(e, "Could not take them out of the room."));
      return "trigger";
    }
  }

  async function leaveTheRoom(): Promise<"trigger" | "gone"> {
    setError(null);
    // Before the await: leaving deletes this member's row, so `rooms.get`
    // turns null and the shell would otherwise redirect to /join first.
    setLeaving(true);
    try {
      await leaveRoom({ code, sessionKey });
      router.replace("/start");
      return "gone";
    } catch (e) {
      setLeaving(false);
      setError(userMessage(e, "Could not leave that room. Please try again."));
      return "trigger";
    }
  }

  const swipe = useCallback(
    async (dir: "yes" | "no") => {
      if (!quest) return;
      setError(null);
      await run(async () => {
        try {
          await cast({ code, sessionKey, questId: quest._id, dir });
        } catch (e) {
          setError(userMessage(e, "That did not register. Try that one again."));
        }
      });
    },
    [quest, cast, code, sessionKey, run],
  );

  /**
   * The host's card timer, as a deadline for THIS card on THIS phone.
   *
   * Per member, not per room, and that follows from the deck itself: `index` is
   * your own swipe count, so two people are looking at different cards at the
   * same moment and a shared deadline would take the card away from whoever
   * arrived at it last. It restarts on every card, and on a room whose host
   * turns the timer off it is null and nothing runs at all.
   */
  const swipeSeconds = view.room.swipeSeconds;
  const questId = quest?._id ?? null;

  /**
   * The deadline is minted DURING the render that first shows the card, not in
   * an effect afterwards, using React's own "adjusting state when a prop
   * changes" shape: compare against the key the state was built for, and set it
   * if it has moved. An effect would mint it a paint later, which on a slow
   * phone is a visible jump from no timer to a running one, and it is the shape
   * `react-hooks/set-state-in-effect` exists to refuse.
   *
   * The clock comes from `useNow` rather than from `Date.now()`: a render must
   * be pure, and the tick store is how this codebase reads the time inside one.
   */
  const timerOn = swipeSeconds > 0 && questId !== null;
  const now = useNow(timerOn);
  const cardKey = `${questId ?? "none"}:${swipeSeconds}`;
  const [card, setCard] = useState<{ key: string; deadlineAt: number | null }>({
    key: "",
    deadlineAt: null,
  });
  if (card.key !== cardKey) {
    setCard({ key: cardKey, deadlineAt: timerOn ? now + swipeSeconds * 1000 : null });
  }

  /**
   * Out of time is a pass, never a yes.
   *
   * A timer that decided FOR you in the direction of doing something would put
   * a night on the table nobody chose; passing costs the room one card.
   *
   * Fired from the interval rather than from an effect watching the count, so
   * the swipe does not depend on a render landing. Nothing needs a fired-once
   * guard on top of the one inside the hook: `swipe` refuses a second call
   * while one is in flight, a successful cast advances `index` and mints a new
   * deadline, and a failed one leaves the card up with its error and both
   * buttons still working.
   */
  const passOnTime = useCallback(() => {
    void swipe("no");
  }, [swipe]);

  const left = useCountdown(card.deadlineAt, passOnTime);

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

  // Answering the last card replaces the screen -- a card advance does not, and
  // is left to the live region below.
  const done = deckSize > 0 && !quest;
  useFocusOnArrival(done, headingRef);

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
    // Everyone the room is still waiting on, matched back to a member row so
    // the host has something to act on. `rooms.get` projects `waitingOn` as
    // names, not ids, so the match is by name -- and where two rows carry the
    // same name, which is exactly what a double-tapped join leaves behind,
    // both appear. That is the honest answer: from here the two are genuinely
    // indistinguishable, and the duplicate IS one of them.
    const stuck = view.members.filter((m) => waiting.includes(m.name));

    return (
      <section className="flex min-h-[60vh] flex-col justify-center gap-4 px-5 py-8">
        <h1 ref={headingRef} tabIndex={-1} className="board text-[11px] text-accent">
          You are through the deck
        </h1>
        <p aria-live="polite" className="text-[15px] leading-snug text-dim">
          {waiting.length > 0
            ? `Waiting on ${nameList(waiting)}.`
            : "Working out where you all landed…"}
        </p>

        {/* The moment a stuck room becomes visible is the moment somebody has
            to be able to unstick it. `rooms.removeMember` and `rooms.leave`
            both carry no status guard and are both accepted here -- and until
            now neither was rendered anywhere but the lobby, so every phone sat
            on "Waiting on Tam." forever and a reload drew the same dead
            screen. */}
        {waiting.length > 0 ? (
          <div className="flex flex-col gap-3 border-t border-hairline pt-4">
            <p className="text-[13px] leading-snug text-dim">
              A closed tab or a seat somebody took twice is usually all this is — nobody
              has done anything wrong. Taking that seat out lets the rest of you finish.
            </p>

            {view.you.isHost ? (
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {stuck
                  .filter((m) => !m.isHost)
                  .map((m) => (
                    <li key={m._id}>
                      <ConfirmButton
                        className="self-start"
                        label={`Take ${m.name} out of the room`}
                        confirmLabel={`Yes, take ${m.name} out`}
                        cancelLabel="Keep them"
                        onConfirm={() => remove(m._id)}
                      />
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="text-[13px] leading-snug text-dim">
                {hostName} can take a seat out if it stays like this.
              </p>
            )}

            {/* The host cannot leave -- `rooms.leave` refuses them with
                HOST_CANNOT_LEAVE, and an orphaned room has nobody to finish
                it. Everyone else can, and leaving lowers the count the room is
                waiting on, so it is a second way out of the same jam. */}
            {view.you.isHost ? null : (
              <ConfirmButton
                className="self-start"
                label="Leave this room"
                confirmLabel={`Yes, leave room ${code}`}
                cancelLabel="Stay"
                onConfirm={() => leaveTheRoom()}
              />
            )}
          </div>
        ) : null}

        {/* Mounted with the screen and empty, so the sentence that arrives in
            it later is actually announced. */}
        <p role="alert" className="text-[13px] leading-snug text-danger empty:-mb-4">
          {error ?? ""}
        </p>
      </section>
    );
  }

  const src = photoSrc(quest, CONVEX_SITE);
  // Google prices most parks, gardens, beaches and trails at nothing at all --
  // the whole `grass` mood -- so an unpriced card is the ordinary case, not an
  // error. `priceLabel` says "Price unknown" for those, which reads badly the
  // moment it is composed into a surrounding sentence.
  const priceKnown = quest.priceCents !== null;

  return (
    <section className="flex flex-col gap-5 px-5 py-8">
      <div className="flex items-baseline justify-between gap-3">
        <p className="board text-[11px] text-accent">
          <span className="num">{index + 1}</span> of <span className="num">{deckSize}</span>
          {/* aria-hidden, and not a live region: a number that changes every
              second would be read out every second, which would make the card
              itself unusable with a screen reader. The one announcement of the
              timer is in the card's own sr-only summary below, once per card,
              which is where a person needs to know it is running. Sighted
              users get the count; nobody gets a ticking earful. */}
          {left !== null ? (
            <span aria-hidden="true" className={left <= 5 ? "num ml-3 text-danger" : "num ml-3 text-dim"}>
              {left}s
            </span>
          ) : null}
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

      {/* A one-cell grid, with both cards placed in that same cell by
          `col-start-1 row-start-1` in `SwipeCard`. The leaving card and the
          arriving card therefore OVERLAP instead of stacking, and the deck's
          height stays the height of one card.

          This is doing the job `mode="popLayout"` is advertised for, because
          popLayout did not do it: measured live, the exiting card stayed
          `position: static` for the whole 178ms exit and the page grew from
          886px to 1167px -- which shoves both buttons off the bottom of a
          phone at the exact moment a thumb is reaching for them. A grid cell
          is two utility classes and cannot silently stop working.

          Default (sync) mode, so the arriving card is there immediately.
          `mode="wait"` would hold the deck empty for the length of the exit,
          which reads as lag on the one screen where answering fast is the
          point.

          `initial={false}` because a card ARRIVING gets no animation. The
          board-flip in globals.css is this product's authored moment and it
          belongs to the match; a swipe is routine and gets no ceremony. */}
      <div className="grid grid-cols-1 grid-rows-1">
        <AnimatePresence initial={false}>
          <SwipeCard
            key={quest._id}
            quest={quest}
            src={src}
            headingRef={headingRef}
            onLean={setLean}
            onCommit={(dir) => {
              setLean(null);
              void swipe(dir);
            }}
          />
        </AnimatePresence>
      </div>

      {/* BELOW the card, not inside it. `SwipeCard` is a `motion.article` with
          `drag="x"`, and an anchor within the drag surface competes for the same
          pointer stream the gesture depends on -- the same conflict the haptics
          comment in that file records for its invisible checkbox. Out here the
          link is just a link and the card is still a card.

          Quiet, not orange: "I'm in" is the decision this screen is asking for,
          and a second filled control beside it would be arguing with the first.
          Keyed on the quest so it never lags a card behind. */}
      <OutLink
        key={`map-${quest._id}`}
        href={venueMapsUrl(quest)}
        className="board border border-hairline text-[11px] text-text"
      >
        See where it is
      </OutLink>

      <p className="text-[12px] leading-snug text-dim">
        {priceKnown
          ? "Costs are estimates, not quotes."
          : "We could not find a price for this one, so there is nothing to estimate. Check before you go."}
        {quest.source === "partner"
          ? " This card is demonstration partner inventory — no venue has signed anything."
          : null}
      </p>

      {/* The card changes under a screen reader with no other signal, because
          the two buttons persist across every card in the deck. */}
      <p aria-live="polite" className="sr-only">
        Option {index + 1} of {deckSize}: {quest.title}.{" "}
        {priceKnown
          ? `About ${quest.priceLabel} each, `
          : "Cost not listed for this one, "}
        {quest.distanceKm} kilometres away.
        {swipeSeconds > 0
          ? ` ${swipeSeconds} seconds to answer, and then it passes itself.`
          : ""}
      </p>

      {/* Mounted before its text arrives, like every other announcement in
          the room. `empty:-mb-5` takes back the flex gap an empty paragraph
          would leave between the card and the buttons -- hiding it would take
          it out of the accessibility tree and be no better than not rendering
          it at all. */}
      <p role="alert" className="text-[13px] leading-snug text-danger empty:-mb-5">
        {error ?? ""}
      </p>

      {/* No `disabled` here on purpose -- `swipe` refuses a second call itself,
          and see the `inFlight` ref above for what `disabled` cost this screen:
          the CTA changing identity on every swipe, and focus falling to <body>
          under a keyboard user's finger. */}
      {/* `selected` is the drag's affordance, not a state of the button itself:
          it lights while a finger is heading this way and goes out if the drag
          comes back. Same ring `Plate` already draws everywhere else. */}
      <div className="flex gap-3">
        <Plate
          variant="raised"
          center
          label="Nah"
          selected={lean === "no"}
          onClick={() => void swipe("no")}
        />
        <Plate
          variant="action"
          center
          label="I’m in"
          selected={lean === "yes"}
          onClick={() => void swipe("yes")}
        />
      </div>
      {/* The timer is the host's rule, so the screen says whose it is and what
          it does BEFORE it does it. A card that vanishes with no warning reads
          as a bug, and a pass nobody chose is exactly the thing to be honest
          about. */}
      <p className="text-center text-[12px] text-dim">
        Arrow keys work too.
        {swipeSeconds > 0
          ? ` ${hostName} set ${swipeSeconds} seconds a card — run out and it counts as a nah.`
          : ""}
      </p>
    </section>
  );
}
