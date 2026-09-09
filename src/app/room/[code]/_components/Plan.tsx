"use client";

import { useCallback, useRef, useState, type RefObject } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Stop } from "@convex/lib/plans/stops";
import { Plate } from "@/components/questly/Plate";
import { useCountdown } from "@/hooks/useCountdown";
import { useFocusOnArrival } from "@/hooks/useFocusOnArrival";
import { useInFlight } from "@/hooks/useInFlight";
import { errorCode, userMessage } from "@/lib/errors";
import type { RoomView } from "../page";
import { PlanBookingPanel } from "./PlanBookingPanel";
import { PlanStopList, type SheetTab } from "./PlanStopList";

/**
 * The night, laid out on the line, while the group is still arguing about it.
 *
 * Every control here mirrors a rule the server already enforces: a group of two
 * or more can only change a stop through a proposal the room votes on, a locked
 * stop cannot be swapped at all, and one stop can carry only one open proposal.
 * The UI must never offer a control the server is going to reject.
 */
export function Plan({
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
  const setLocked = useMutation(api.plans.setLocked);
  const replaceStop = useMutation(api.plans.replaceStop);
  const openProposal = useMutation(api.proposals.open);
  const voteOnProposal = useMutation(api.proposals.vote);
  const suggestStop = useAction(api.plans.suggestStop);
  const searchStop = useAction(api.plans.searchStop);
  const confirm = useMutation(api.bookings.confirm);
  const retract = useMutation(api.bookings.retract);
  const retryPlan = useMutation(api.plans.retry);

  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const [tab, setTab] = useState<SheetTab>("ask");
  const [options, setOptions] = useState<Stop[]>([]);
  const [queryText, setQueryText] = useState("");
  const [reason, setReason] = useState("");
  // Three separate flags, not one: a sheet loading its options must not put
  // "Booking…" on the button at the bottom of the screen.
  const [loading, setLoading] = useState(false);
  const [booking, setBooking] = useState(false);
  const [confirmBook, setConfirmBook] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The "Writing the plan…" screen's own two flags. Kept apart from `error`
  // because the likeliest answer there -- "it is still being written" -- is
  // reassurance, not a failure, and must not be painted in danger red.
  const [retrying, setRetrying] = useState(false);
  const [planNote, setPlanNote] = useState<{ text: string; calm: boolean } | null>(null);

  const plan = view.plan;
  // The server enforces this split too. A room of one edits directly; a room of
  // two or more proposes and votes.
  const isGroup = view.members.length > 1;
  /**
   * Whether locking is a vote HERE, which is the rule and the roster together.
   *
   * `plans.setLocked` applies a lock directly in a room of one whatever the
   * rule says, because `needed(1)` is 1 and a proposal would carry itself. A
   * button offering to "ask the room" when there is no room to ask would be
   * describing something the server is not going to do.
   */
  const lockByVote = view.room.lockRule === "vote" && isGroup;

  /**
   * Whether this member may touch the lock at all.
   *
   * Under `lockRule: "host"` the server refuses everybody else, for locking and
   * for unlocking alike. This file's opening promise is that the UI never
   * offers a control the server is going to reject, so the control is withheld
   * and the rule is stated instead -- `lockLine` above the list already says
   * whose job it is, so nothing here has to repeat it.
   */
  const mayLock = view.room.lockRule !== "host" || view.you.isHost;

  /**
   * The plan's arrival REPLACES this screen, so focus moves with it.
   *
   * The "It's a match" branch below is not a card changing inside a screen that
   * stays put: when `plan` lands, that whole branch is destroyed -- including
   * the <h1> the shell has just moved focus to, and including the live region
   * that used to sit in it announcing nothing (its text never changed; it was
   * unmounted, not updated). Focus fell to <body> and a screen-reader user was
   * left on the document root while the itinerary they were promised appeared
   * silently. `status` does not change across this transition, so the shell's
   * policy correctly does not fire -- this is the one local move it cannot see.
   */
  useFocusOnArrival(plan !== null, headingRef);

  /**
   * Booking is irreversible, so its confirmation gets the same focus treatment
   * as removing somebody: Plate renders the <button>, and takes no ref of its
   * own, so the focus lands through the wrapper.
   */
  const focusFirstButton = useCallback((node: HTMLDivElement | null) => {
    node?.querySelector("button")?.focus();
  }, []);
  const restoreBook = useRef(false);
  const bookRestore = useCallback((node: HTMLDivElement | null) => {
    if (node && restoreBook.current) {
      restoreBook.current = false;
      node.querySelector("button")?.focus();
    }
  }, []);
  /**
   * The house rule that decides what the button at the bottom of this screen
   * actually does, and the vote it runs when that rule is a vote.
   *
   * Read from the room, not assumed: `bookings.confirm` enforces the same rule
   * and this screen must never offer a control the server will refuse. Under
   * "host" a guest is told whose tap it is instead of being handed a button
   * that throws.
   *
   * The countdown hook is called unconditionally with a null deadline when
   * there is nothing running, because a hook behind an `if` is a different
   * hook order on the render after the vote opens.
   */
  const rule = view.room.finalizeRule;
  const voting = rule === "majority" || rule === "all";
  const secondsToVote = useCountdown(voting ? view.finalize.deadlineAt : null);
  /**
   * A window that has run out counts for nothing, and this screen is where
   * that becomes visible first.
   *
   * `rooms.get` deliberately hands over the deadline rather than deciding the
   * question itself -- a query does not re-run because a second passed, so a
   * server-side "lapsed" would be whatever was true at the last write. The
   * clock here is the same clock the countdown uses, and `bookings.confirm`
   * reaches the same answer the moment anybody taps again.
   */
  const voteLapsed = secondsToVote === 0;
  const votes = voteLapsed ? 0 : view.finalize.votes;
  const youVoted = !voteLapsed && view.finalize.youVoted;
  const hostName = view.members.find((m) => m.isHost)?.name ?? "The host";

  async function loadOptions(stopId: string, which: SheetTab, text = "") {
    if (!plan) return;
    const stop = plan.stops.find((s) => s.id === stopId);
    if (!stop) return;
    setLoading(true);
    setError(null);
    try {
      const result =
        which === "ask"
          ? await suggestStop({ code, sessionKey, stopId })
          : await searchStop({ code, sessionKey, query: text, slot: stop.slot });
      setOptions(result.options);
    } catch (e) {
      setError(userMessage(e, "Could not load any options for that stop."));
      setOptions([]);
    } finally {
      setLoading(false);
    }
  }

  function openSheet(stopId: string) {
    setSheetFor(stopId);
    setTab("ask");
    setOptions([]);
    setQueryText("");
    setReason("");
    void loadOptions(stopId, "ask");
  }

  // The guard for every write on this screen. A ref and not a `disabled` flag,
  // which used to sit on the very vote button being pressed: see `useInFlight`.
  const write = useInFlight();

  async function choose(stopId: string, replacement: Stop) {
    setError(null);
    await write(async () => {
      try {
        if (isGroup) {
          await openProposal({ code, sessionKey, stopId, replacement, reason: reason.trim() });
        } else {
          await replaceStop({ code, sessionKey, stopId, replacement });
        }
        setSheetFor(null);
        setOptions([]);
        setReason("");
      } catch (e) {
        setError(userMessage(e, "Could not change that stop."));
      }
    });
  }

  /**
   * The stop whose vote block this member just opened, so focus can follow the
   * control that vanished out from under it.
   *
   * A ref rather than state, and read inside the ref callback rather than
   * during render: `askedOn.current` in a render body is a ref read the React
   * Compiler refuses, and setting state from a ref callback to clear it is the
   * same problem wearing a hat. The callback below is attached to EVERY vote
   * block and decides for itself, so a proposal somebody else opened cannot
   * pull focus off whatever this member was doing.
   */
  const askedOn = useRef<string | null>(null);

  const focusAskedVote = useCallback((node: HTMLDivElement | null) => {
    if (!node || node.dataset.stopId !== askedOn.current) return;
    askedOn.current = null;
    node.querySelector("button")?.focus();
  }, []);

  async function toggleLock(stopId: string, locked: boolean) {
    // The guard matters here in particular. It was survivable while a lock was
    // an idempotent patch; under the vote rule a double tap makes the SECOND
    // call collide with the proposal the first one opened, and the room is told
    // PROPOSAL_EXISTS about its own tap.
    setError(null);
    await write(async () => {
      try {
        await setLocked({ code, sessionKey, stopId, locked });
        // Under the vote rule the control that was just pressed is replaced by
        // the vote block below it. Unmounting a focused <button> hands focus
        // back to <body> -- the failure this file legislates against in three
        // other places -- so it is handed to the block that took its place.
        if (lockByVote) askedOn.current = stopId;
      } catch (e) {
        setError(
          userMessage(
            e,
            // Under the vote rule the tap does not change the stop, it asks the
            // room to, and an error saying otherwise names the wrong failure.
            lockByVote ? "Could not ask the room about that stop." : "Could not change that stop.",
          ),
        );
      }
    });
  }

  async function castVote(proposalId: RoomView["proposals"][number]["_id"], vote: "yes" | "no") {
    setError(null);
    await write(async () => {
      try {
        await voteOnProposal({ code, sessionKey, proposalId, vote });
      } catch (e) {
        setError(userMessage(e, "Could not record that vote."));
      }
    });
  }

  async function bookIt() {
    // A guard rather than `disabled` on the button that currently has focus:
    // disabling a focused control drops focus to <body>.
    if (booking) return;
    setBooking(true);
    setError(null);
    try {
      const settled = await confirm({ code, sessionKey });
      // Under a vote rule the ordinary outcome is that this tap was a yes and
      // the room is still short, which replaces nothing: the screen stays, so
      // the flag has to come back down and the confirmation has to close.
      // When it DID book, none of that runs -- the room's status becomes
      // "booked" in the same breath and this screen is replaced.
      if (!settled.booked) {
        restoreBook.current = true;
        setConfirmBook(false);
        setBooking(false);
      }
    } catch (e) {
      setError(userMessage(e, "Could not book that. Please try again."));
      setBooking(false);
    }
  }

  /**
   * Take your yes back.
   *
   * No confirmation step, and that is not an inconsistency: the two-step
   * ceremony below exists because booking cannot be undone, and this is the
   * undo. Making it harder to leave a vote than to join one is how a group
   * ends up booked by people who changed their minds.
   */
  async function takeItBack() {
    if (booking) return;
    setError(null);
    try {
      await retract({ code, sessionKey });
    } catch (e) {
      setError(userMessage(e, "Could not take that back. Please try again."));
    }
  }

  /**
   * Ask for the plan again.
   *
   * A guard rather than `disabled` on the button being pressed: disabling a
   * focused control hands focus back to <body>, and on this screen it is the
   * only control there is. PLAN_IN_PROGRESS is not a failure -- it is the room
   * telling the host the build is genuinely still running -- so it renders in
   * the dim tone rather than the danger one.
   */
  async function askForThePlanAgain() {
    if (retrying) return;
    setRetrying(true);
    setPlanNote(null);
    try {
      await retryPlan({ code, sessionKey });
    } catch (e) {
      setPlanNote({
        text: userMessage(e, "Could not ask for the plan again. Please try again."),
        calm: errorCode(e) === "PLAN_IN_PROGRESS",
      });
    } finally {
      setRetrying(false);
    }
  }

  if (!plan) {
    return (
      <section className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-5">
        <h1 ref={headingRef} tabIndex={-1} className="board flap text-[11px] text-accent">
          It&rsquo;s a match
        </h1>
        {/* This whole branch, heading included, is replaced when the plan
            lands: `useFocusOnArrival` above moves focus onto the new heading,
            which is what announces the itinerary. */}
        <p className="text-[15px] leading-snug text-dim">Writing the plan…</p>

        {/* The plan-side twin of the deck's "Build it again". A build that is
            killed outright -- a deploy, a timeout, a crash -- leaves a matched
            room on this sentence forever, and a reload draws the same dead
            screen. `plans.retry` refuses politely while a build is genuinely
            in flight and does nothing at all once a plan exists, so pressing
            it early is safe; the plan itself arrives on the room subscription,
            so nothing here polls. */}
        {view.you.isHost ? (
          <Plate
            variant="ghost"
            center
            className="mt-2 max-w-[320px]"
            label={retrying ? "Asking again…" : "Write it again"}
            sub="Only if this has been sitting here a minute or so."
            onClick={() => void askForThePlanAgain()}
          />
        ) : (
          // `plans.retry` is host-only, so a control here would only ever be
          // refused.
          <p className="text-center text-[13px] leading-snug text-dim">
            If this sits here, {view.members.find((m) => m.isHost)?.name ?? "the host"} can
            ask for it again.
          </p>
        )}

        {/* Mounted with the screen and empty, so the sentence that arrives in
            it later is actually announced. */}
        <p
          role="alert"
          className={`max-w-[320px] text-center text-[13px] leading-snug ${
            planNote?.calm ? "text-dim" : "text-danger"
          }`}
        >
          {planNote?.text ?? ""}
        </p>
      </section>
    );
  }

  /**
   * Why an open swap sheet has closed, or null while it is still a valid thing
   * to have open. Derived, never an effect: two phones can both have this sheet
   * open on the same stop, and the moment one of them proposes -- or anybody
   * locks the stop -- every option Plate in the other's sheet is a guaranteed
   * PROPOSAL_EXISTS or STOP_LOCKED. A control that exists only to be refused is
   * worse than no control, and a sheet that vanishes with no explanation is
   * worse than either.
   */
  const sheetStop = sheetFor === null ? null : plan.stops.find((s) => s.id === sheetFor);
  const sheetClosedBecause =
    sheetFor === null
      ? null
      : view.proposals.some((p) => p.stopId === sheetFor)
        ? "Someone else proposed a change to this stop while this was open. Their proposal is above — vote on that instead."
        : sheetStop?.locked
          ? "This stop was locked while this was open. Unlock it to swap it."
          : null;

  return (
    <section className="flex flex-col gap-7 px-5 py-8">
      <PlanStopList
        view={view}
        plan={plan}
        headingRef={headingRef}
        isGroup={isGroup}
        lockByVote={lockByVote}
        mayLock={mayLock}
        sheetFor={sheetFor}
        tab={tab}
        options={options}
        queryText={queryText}
        reason={reason}
        loading={loading}
        sheetClosedBecause={sheetClosedBecause}
        setSheetFor={setSheetFor}
        setTab={setTab}
        setOptions={setOptions}
        setQueryText={setQueryText}
        setReason={setReason}
        openSheet={openSheet}
        loadOptions={loadOptions}
        choose={choose}
        toggleLock={toggleLock}
        castVote={castVote}
        focusAskedVote={focusAskedVote}
      />
      <PlanBookingPanel
        view={view}
        plan={plan}
        error={error}
        rule={rule}
        voting={voting}
        voteLapsed={voteLapsed}
        votes={votes}
        youVoted={youVoted}
        hostName={hostName}
        secondsToVote={secondsToVote}
        booking={booking}
        confirmBook={confirmBook}
        setConfirmBook={setConfirmBook}
        focusFirstButton={focusFirstButton}
        restoreBookRef={restoreBook}
        bookRestore={bookRestore}
        bookIt={bookIt}
        takeItBack={takeItBack}
      />
    </section>
  );
}
