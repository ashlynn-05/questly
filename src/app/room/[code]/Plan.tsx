"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Stop } from "@convex/lib/stops";
import { Plate } from "@/components/questly/Plate";
import { Rail, RailEnd, RailNode } from "@/components/questly/Rail";
import { useCountdown } from "@/components/questly/useCountdown";
import { clockFace } from "@/lib/countdown";
import { errorCode, userMessage } from "@/lib/errors";
import { lockLine, proposalCard, proposalLine } from "@/lib/houseRules";
import type { RoomView } from "./page";

const time = (at: number) =>
  new Date(at).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });

const money = (cents: number) => (cents === 0 ? "Free" : `$${Math.round(cents / 100)}`);

/** Which half of the swap sheet is showing. */
type SheetTab = "ask" | "search";

const SLOT_LABEL: Record<Stop["slot"], string> = {
  meet: "Meet",
  main: "Main",
  after: "After",
};

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
  const hadPlan = useRef(plan !== null);
  useEffect(() => {
    if (!plan || hadPlan.current) return;
    hadPlan.current = true;
    headingRef.current?.focus();
  }, [plan, headingRef]);

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

  /**
   * The in-flight guard for every write on this screen, as a ref rather than a
   * `disabled` flag.
   *
   * A `disabled` flag used to sit on the very vote button being pressed, and on
   * every option in an open sheet -- so casting a vote by keyboard disabled the
   * control that had focus and dropped focus to <body>. This file states the
   * rule twice already (`bookIt` and `askForThePlanAgain`); it just was not
   * applied here. A ref only has to stop a second concurrent call, and does not
   * re-render, so nothing under the user's finger changes state.
   */
  const writing = useRef(false);

  async function choose(stopId: string, replacement: Stop) {
    if (writing.current) return;
    writing.current = true;
    setError(null);
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
    } finally {
      writing.current = false;
    }
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
    // The same in-flight guard every other write on this screen uses. It was
    // survivable while a lock was an idempotent patch; under the vote rule a
    // double tap makes the SECOND call collide with the proposal the first one
    // opened, and the room is told PROPOSAL_EXISTS about its own tap.
    if (writing.current) return;
    writing.current = true;
    setError(null);
    try {
      await setLocked({ code, sessionKey, stopId, locked });
      // Under the vote rule the control that was just pressed is replaced by
      // the vote block below it. Unmounting a focused <button> hands focus back
      // to <body> -- the failure this file legislates against in three other
      // places -- so it is handed to the block that took its place instead.
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
    } finally {
      writing.current = false;
    }
  }

  async function castVote(proposalId: RoomView["proposals"][number]["_id"], vote: "yes" | "no") {
    if (writing.current) return;
    writing.current = true;
    setError(null);
    try {
      await voteOnProposal({ code, sessionKey, proposalId, vote });
    } catch (e) {
      setError(userMessage(e, "Could not record that vote."));
    } finally {
      writing.current = false;
    }
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
            lands: the effect above moves focus onto the new heading, which is
            what announces the itinerary. */}
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
      <div>
        <p className="board text-[11px] text-accent">The plan</p>
        <h1 ref={headingRef} tabIndex={-1} className="display mt-2 text-[34px] text-text">
          {plan.stops.find((s) => s.slot === "main")?.name ?? "Your night"}
        </h1>
        <p className="mt-2 text-[13px] text-dim">
          <span className="num">{view.members.length}</span>{" "}
          {view.members.length === 1 ? "person" : "people"}, starting{" "}
          <span className="num">{time(view.room.whenAt)}</span>.
        </p>
        {/* The rule next to the controls it governs. `isGroup` goes with it
            because in a room of one every lock is a tap regardless of what the
            host chose, and stating the rule flatly would be a promise the
            server does not keep. */}
        <p className="mt-2 text-[12px] leading-snug text-dim">
          {lockLine(view.room.lockRule, isGroup)}
        </p>
      </div>

      {/* The rail belongs to the container; every stop carries its own node and
          its own left padding, so a stop can grow -- a proposal, an open swap
          sheet -- without the roundels sliding off the line. */}
      <div className="relative">
        <Rail drawing />
        <ol className="m-0 flex list-none flex-col gap-7 p-0">
          {plan.stops.map((stop, i) => {
            const proposal = view.proposals.find((p) => p.stopId === stop.id);
            return (
              <li key={stop.id} className="relative pl-14">
                <RailNode top={6} state={proposal ? "live" : stop.locked ? "locked" : "open"} />

                {/* Mounted with the stop and empty until a proposal lands on
                    it. When somebody else proposes, the whole vote block below
                    is INSERTED while the lock and swap controls above it stay
                    put -- so nothing is unmounted, focus correctly does not
                    move, and a live region is the only thing left that can say
                    a vote has opened on your night. The count inside the block
                    could not do that job: it was mounted with its text already
                    in it, which announces nothing. `sr-only` is absolutely
                    positioned, so this costs no layout. */}
                <p aria-live="polite" className="sr-only">
                  {proposal
                    ? `${proposalLine(
                        proposal.kind,
                        proposal.proposedByName,
                        stop.name,
                        proposal.replacement?.name ?? null,
                      )} ${proposal.yes} of ${proposal.needed} needed.`
                    : ""}
                </p>

                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <p className="board text-[10px] text-accent">
                      {SLOT_LABEL[stop.slot]} · <span className="num">{time(stop.startAt)}</span>
                      {/* Who locked it, not just that it is locked. A silent
                          lock was the actual complaint in issue #11 -- see the
                          ruling above `plans.setLocked`. Falls back to the bare
                          word for stops locked before the field existed. */}
                      {stop.locked ? (
                        <span className="ml-2 text-dim">
                          {stop.lockedBy ? `Locked by ${stop.lockedBy}` : "Locked"}
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-1 text-[19px] leading-snug text-text">{stop.name}</p>
                    {stop.note ? (
                      <p className="mt-1 text-[13px] leading-snug text-dim">{stop.note}</p>
                    ) : null}
                  </div>
                  <p className="num shrink-0 text-[17px] text-text">
                    {money(stop.costPerHeadCents)}
                  </p>
                </div>

                <div className="mt-3 flex gap-2">
                  {lockByVote ? (
                    /* Under the vote rule this is not a toggle and must not
                       announce as one: the tap opens a proposal, and the stop
                       does not change until the room agrees. So the label says
                       what the tap actually does, and there is no pressed
                       state to claim otherwise. Withheld entirely while a
                       proposal is open on this stop, because the server refuses
                       a second one and the vote block below already carries the
                       decision. */
                    proposal ? null : (
                      <Plate
                        variant="ghost"
                        label={stop.locked ? "Ask the room to unlock this" : "Ask the room to lock this"}
                        onClick={() => void toggleLock(stop.id, !stop.locked)}
                      />
                    )
                  ) : (
                    /* A genuine toggle, so it announces as one. The label stays
                       put and the pressed state, the filled roundel and the
                       "Locked" line carry the state -- never colour alone. */
                    <Plate
                      variant="ghost"
                      selected={stop.locked}
                      label="Lock this stop"
                      onClick={() => void toggleLock(stop.id, !stop.locked)}
                    />
                  )}
                  {/* Not offered on a locked stop, and not offered while this
                      stop already has a proposal open: the server refuses both,
                      and a control that exists only to be rejected is worse
                      than no control. */}
                  {!stop.locked && !proposal ? (
                    <Plate
                      variant="ghost"
                      label={isGroup ? "Propose a change" : "Swap this stop"}
                      onClick={() => openSheet(stop.id)}
                    />
                  ) : null}
                </div>

                {proposal ? (
                  <div
                    ref={focusAskedVote}
                    data-stop-id={stop.id}
                    className="mt-3 rounded-[6px] border border-hairline p-3"
                  >
                    <p className="board text-[10px] text-accent">
                      {proposalCard(
                        proposal.kind,
                        proposal.proposedByName,
                        proposal.replacement?.name ?? null,
                      ).heading}
                    </p>
                    <p className="mt-1 text-[15px] leading-snug text-text">
                      {proposalCard(
                        proposal.kind,
                        proposal.proposedByName,
                        proposal.replacement?.name ?? null,
                      ).detail}
                    </p>
                    {proposal.reason ? (
                      <p className="mt-1 text-[13px] leading-snug text-dim">
                        “{proposal.reason}”
                      </p>
                    ) : null}
                    {/* No aria-live here: this arrives already filled, which
                        announces nothing, and the always-mounted region at the
                        top of the stop carries the same count to a screen
                        reader as it changes. */}
                    <p className="num mt-2 text-[13px] text-dim">
                      {proposal.yes} of {proposal.needed} needed
                    </p>
                    {stop.locked && proposal.kind === "swap" ? (
                      // A lock does not close voting, and withholding the
                      // buttons here was too blunt: `proposals.vote` writes the
                      // row first and only throws STOP_LOCKED when a DECIDING
                      // yes cannot be applied. A no still lands and can settle
                      // the proposal as rejected, which is exactly how a room
                      // clears a stale proposal off a stop it wants to keep.
                      // So say what the lock means and leave the choice open;
                      // the one refusable case surfaces through castVote's
                      // catch. The copy deliberately does not point at an
                      // unlock control: under the vote rule there is none while
                      // a proposal is open, so naming one would be a promise
                      // the screen cannot keep.
                      <p className="mt-2 text-[12px] leading-snug text-dim">
                        This stop is locked, so an accepted swap cannot be applied until it
                        is unlocked. A no still counts.
                      </p>
                    ) : null}
                    {proposal.yourVote === null ? (
                      <div className="mt-3 flex gap-2">
                        <Plate
                          variant="action"
                          center
                          label="Yes"
                          onClick={() => void castVote(proposal._id, "yes")}
                        />
                        <Plate
                          variant="ghost"
                          center
                          label="No"
                          onClick={() => void castVote(proposal._id, "no")}
                        />
                      </div>
                    ) : (
                      // Which way you voted, and a way back. The server takes
                      // yes|no and PATCHES the row you already have, so a
                      // mis-tap on a group decision is correctable -- and
                      // somebody who voted no no longer sees exactly what
                      // somebody who has not voted sees.
                      <div className="mt-3 flex flex-col gap-2">
                        <p className="text-[12px] text-dim">
                          You voted {proposal.yourVote}.
                        </p>
                        <Plate
                          variant="ghost"
                          label={proposal.yourVote === "yes" ? "Change it to no" : "Change it to yes"}
                          onClick={() =>
                            void castVote(proposal._id, proposal.yourVote === "yes" ? "no" : "yes")
                          }
                        />
                      </div>
                    )}
                  </div>
                ) : null}

                {sheetFor === stop.id ? (
                  <div className="mt-3 rounded-[6px] border border-hairline p-3">
                    {/* Mounted with the sheet and empty, so the sentence that
                        arrives in it when the stop moves underneath is
                        actually announced rather than silently swapped in. */}
                    <p aria-live="polite" className="text-[13px] leading-snug text-dim">
                      {sheetClosedBecause ?? ""}
                    </p>

                    {sheetClosedBecause ? (
                      <Plate
                        variant="ghost"
                        center
                        label="Close"
                        className="mt-3"
                        onClick={() => setSheetFor(null)}
                      />
                    ) : (
                      <>
                        <h2 className="board text-[10px] text-accent">Instead of {stop.name}</h2>

                        <div className="mt-3 flex gap-2">
                          <Plate
                            variant="raised"
                            selected={tab === "ask"}
                            label="Suggest something"
                            onClick={() => {
                              setTab("ask");
                              void loadOptions(stop.id, "ask");
                            }}
                          />
                          <Plate
                            variant="raised"
                            selected={tab === "search"}
                            label="Pick it yourself"
                            onClick={() => {
                              setTab("search");
                              setOptions([]);
                            }}
                          />
                        </div>

                        {tab === "search" ? (
                          <form
                            className="mt-3 flex gap-2"
                            onSubmit={(e) => {
                              e.preventDefault();
                              void loadOptions(stop.id, "search", queryText);
                            }}
                          >
                            <label htmlFor={`q-${stop.id}`} className="sr-only">
                              Search for a place
                            </label>
                            <input
                              id={`q-${stop.id}`}
                              value={queryText}
                              onChange={(e) => setQueryText(e.target.value)}
                              placeholder="wine bar in Fitzroy"
                              className="min-h-[44px] flex-1 rounded-[5px] border border-hairline bg-transparent px-3 text-[16px] text-text"
                            />
                            <button
                              type="submit"
                              className="board min-h-[44px] shrink-0 rounded-[5px] border border-action-edge bg-action px-4 text-[11px] text-on-action"
                            >
                              Find
                            </button>
                          </form>
                        ) : null}

                        {isGroup ? (
                          <div className="mt-3 flex flex-col gap-2">
                            <label htmlFor={`why-${stop.id}`} className="board text-[10px] text-dim">
                              Why, in a few words (optional)
                            </label>
                            <input
                              id={`why-${stop.id}`}
                              value={reason}
                              onChange={(e) => setReason(e.target.value)}
                              maxLength={80}
                              placeholder="it is five minutes from the tram"
                              className="min-h-[44px] rounded-[5px] border border-hairline bg-transparent px-3 text-[16px] text-text"
                            />
                          </div>
                        ) : null}

                        <div aria-live="polite" className="mt-3 flex flex-col gap-2">
                          {loading ? <p className="text-[13px] text-dim">Looking…</p> : null}
                          {!loading && options.length === 0 ? (
                            <p className="text-[13px] leading-snug text-dim">
                              {tab === "search"
                                ? "Type what you are after."
                                : "Nothing came back. Try picking it yourself."}
                            </p>
                          ) : null}
                          {options.map((option) => (
                            <Plate
                              key={option.id}
                              variant="raised"
                              label={option.name}
                              sub={option.note}
                              right={money(option.costPerHeadCents)}
                              onClick={() => void choose(stop.id, option)}
                            />
                          ))}
                        </div>

                        <p className="mt-3 text-[12px] leading-snug text-dim">
                          Costs are estimates, not quotes.{" "}
                          {isGroup
                            ? "Picking one puts it to the room."
                            : "Picking one changes the plan."}
                        </p>

                        <Plate
                          variant="ghost"
                          center
                          label="Close"
                          className="mt-3"
                          onClick={() => setSheetFor(null)}
                        />
                      </>
                    )}
                  </div>
                ) : null}

                {/* The line ends ON the last stop: the rail is drawn on the
                    container, so without this it ran the full height of an
                    open sheet past the final roundel into nothing. */}
                {i === plan.stops.length - 1 ? <RailEnd top={15} /> : null}
              </li>
            );
          })}
        </ol>
      </div>

      <div className="flex items-baseline justify-between border-t border-hairline pt-4">
        <p className="board text-[11px] text-dim">Est. per head</p>
        <p className={`num text-[24px] ${plan.overBudget ? "text-danger" : "text-text"}`}>
          {money(plan.totalPerHeadCents)}
        </p>
      </div>

      {/* Derived per request from the current stops and the room's budget, so
          it is right the instant a swap lands. Nothing refuses an expensive
          swap -- the group is allowed to decide to overspend, knowingly. */}
      {/* Always mounted, like every other announcement on this screen: a
          region inserted into the DOM at the moment its text arrives is the
          pattern this file warns against eight lines below. `empty:-mb-7`
          takes back the flex gap an empty paragraph would leave -- hiding it
          would take it out of the accessibility tree and be no better than not
          rendering it. */}
      <p role="alert" className="text-[13px] leading-snug text-danger empty:-mb-7">
        {plan.overBudget
          ? `That is over the ${money(view.room.budgetPerHeadCents)} each you set. Swap a stop, or go anyway.`
          : ""}
      </p>

      {/* Always mounted, filled when something is refused: the same rule as
          every other announcement on this screen. */}
      <p role="alert" className="text-[13px] leading-snug text-danger empty:-mb-7">
        {error ?? ""}
      </p>

      {/* Two steps, for R55's reason and more so: removing one guest is
          undoable by sending them the link again, whereas booking closes the
          lock, swap, propose and vote paths for everyone, permanently. The
          ceremony has to be at least as heavy as the smaller decision's. */}
      <div className="flex flex-col gap-2">
        {/* The tally, announced. Every phone in the room is subscribed to
            `rooms.get`, so somebody else saying they are in has to reach this
            screen as more than a number quietly changing in the corner. The
            countdown is NOT in the live region and is aria-hidden: a value
            that changes every second would be read out every second. */}
        {voting ? (
          <div className="flex flex-col gap-1 border-t border-hairline pt-4">
            <p aria-live="polite" className="text-[13px] leading-snug text-dim">
              {voteLapsed
                ? "The vote ran out, so it starts again from the next yes."
                : `${votes} of ${view.finalize.needed} in${
                    view.finalize.voters.length > 0 && !voteLapsed
                      ? `: ${view.finalize.voters.join(", ")}`
                      : ""
                  }.`}
            </p>
            {!voteLapsed && secondsToVote !== null ? (
              <p aria-hidden="true" className="num text-[13px] text-dim">
                {clockFace(secondsToVote)} left
              </p>
            ) : null}
          </div>
        ) : null}

        {/* A guest is told whose tap it is rather than handed a button that
            `bookings.confirm` is going to refuse. */}
        {rule === "host" && !view.you.isHost ? (
          <p className="text-[13px] leading-snug text-dim">
            {hostName} settles this one. Tell them when you are happy with it.
          </p>
        ) : youVoted ? (
          <>
            <p className="text-[13px] leading-snug text-dim">
              You are in. {rule === "all" ? "Waiting on the rest." : "Waiting on the others."}
            </p>
            {/* One step, deliberately. The ceremony below exists because
                booking cannot be undone; this IS the undo. */}
            <Plate
              variant="ghost"
              center
              label="Take my yes back"
              onClick={() => void takeItBack()}
            />
          </>
        ) : confirmBook ? (
          <div ref={focusFirstButton} className="flex flex-col gap-2">
            <Plate
              variant="action"
              center
              label={booking ? (voting ? "Saying yes…" : "Booking…") : voting ? "Yes, I am in" : "Yes, book it"}
              sub={
                voting
                  ? "It books the moment the room gets there. Nobody can swap a stop after that."
                  : "Nobody can swap a stop after this."
              }
              onClick={() => void bookIt()}
            />
            <Plate
              variant="ghost"
              center
              label="Not yet"
              onClick={() => {
                restoreBook.current = true;
                setConfirmBook(false);
              }}
            />
          </div>
        ) : (
          <div ref={bookRestore}>
            <Plate
              variant="action"
              center
              label={voting ? "I am in" : "Book it"}
              sub={
                voting
                  ? rule === "all"
                    ? "It books when everyone is in."
                    : "It books when most of you are in."
                  : "Settles the plan for everyone — no more swaps after this."
              }
              onClick={() => setConfirmBook(true)}
            />
          </div>
        )}
        <p className="text-[12px] leading-snug text-dim">
          Booking here is simulated: no table is held and no venue is contacted. Costs are
          estimates, not quotes.
        </p>
      </div>
    </section>
  );
}
