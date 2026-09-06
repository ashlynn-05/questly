"use client";

import { useState, type RefObject } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Stop } from "@convex/lib/stops";
import { Plate } from "@/components/questly/Plate";
import { Rail, RailNode } from "@/components/questly/Rail";
import { userMessage } from "@/lib/errors";
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

  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const [tab, setTab] = useState<SheetTab>("ask");
  const [options, setOptions] = useState<Stop[]>([]);
  const [queryText, setQueryText] = useState("");
  const [reason, setReason] = useState("");
  // Three separate flags, not one: a sheet loading its options must not put
  // "Booking…" on the button at the bottom of the screen.
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plan = view.plan;
  // The server enforces this split too. A room of one edits directly; a room of
  // two or more proposes and votes.
  const isGroup = view.members.length > 1;

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

  async function choose(stopId: string, replacement: Stop) {
    setSaving(true);
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
      setSaving(false);
    }
  }

  async function toggleLock(stopId: string, locked: boolean) {
    setError(null);
    try {
      await setLocked({ code, sessionKey, stopId, locked });
    } catch (e) {
      setError(userMessage(e, "Could not change that stop."));
    }
  }

  async function castVote(proposalId: RoomView["proposals"][number]["_id"], vote: "yes" | "no") {
    setSaving(true);
    setError(null);
    try {
      await voteOnProposal({ code, sessionKey, proposalId, vote });
    } catch (e) {
      setError(userMessage(e, "Could not record that vote."));
    } finally {
      setSaving(false);
    }
  }

  async function bookIt() {
    setBooking(true);
    setError(null);
    try {
      await confirm({ code, sessionKey });
      // No setBooking(false): the room's status becomes "booked" in the same
      // breath and this screen is replaced.
    } catch (e) {
      setError(userMessage(e, "Could not book that. Please try again."));
      setBooking(false);
    }
  }

  if (!plan) {
    return (
      <section className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-5">
        <h1 ref={headingRef} tabIndex={-1} className="board flap text-[11px] text-accent">
          It&rsquo;s a match
        </h1>
        {/* Nobody pressed anything to get here and nothing is unmounting, so
            the arrival of the plan is announced rather than focused. */}
        <p aria-live="polite" className="text-[15px] leading-snug text-dim">
          Writing the plan…
        </p>
      </section>
    );
  }

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
      </div>

      {/* The rail belongs to the container; every stop carries its own node and
          its own left padding, so a stop can grow -- a proposal, an open swap
          sheet -- without the roundels sliding off the line. */}
      <div className="relative">
        <Rail drawing />
        <ol className="m-0 flex list-none flex-col gap-7 p-0">
          {plan.stops.map((stop) => {
            const proposal = view.proposals.find((p) => p.stopId === stop.id);
            return (
              <li key={stop.id} className="relative pl-14">
                <RailNode top={6} state={proposal ? "live" : stop.locked ? "locked" : "open"} />

                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <p className="board text-[10px] text-accent">
                      {SLOT_LABEL[stop.slot]} · <span className="num">{time(stop.startAt)}</span>
                      {stop.locked ? <span className="ml-2 text-dim">Locked</span> : null}
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
                  {/* A genuine toggle, so it announces as one. The label stays
                      put and the pressed state, the filled roundel and the
                      "Locked" line carry the state -- never colour alone. */}
                  <Plate
                    variant="ghost"
                    selected={stop.locked}
                    label="Lock this stop"
                    onClick={() => void toggleLock(stop.id, !stop.locked)}
                  />
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
                  <div className="mt-3 rounded-[6px] border border-hairline p-3">
                    <p className="board text-[10px] text-accent">
                      {proposal.proposedByName} wants to swap this
                    </p>
                    <p className="mt-1 text-[15px] leading-snug text-text">
                      {proposal.replacement.name}
                    </p>
                    {proposal.reason ? (
                      <p className="mt-1 text-[13px] leading-snug text-dim">
                        “{proposal.reason}”
                      </p>
                    ) : null}
                    <p aria-live="polite" className="num mt-2 text-[13px] text-dim">
                      {proposal.yes} of {proposal.needed} needed
                    </p>
                    {proposal.youVoted ? (
                      <p className="mt-2 text-[12px] text-dim">Your vote is in.</p>
                    ) : (
                      <div className="mt-3 flex gap-2">
                        <Plate
                          variant="action"
                          center
                          label="Yes"
                          disabled={saving}
                          onClick={() => void castVote(proposal._id, "yes")}
                        />
                        <Plate
                          variant="ghost"
                          center
                          label="No"
                          disabled={saving}
                          onClick={() => void castVote(proposal._id, "no")}
                        />
                      </div>
                    )}
                  </div>
                ) : null}

                {sheetFor === stop.id ? (
                  <div className="mt-3 rounded-[6px] border border-hairline p-3">
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
                          className="board min-h-[44px] shrink-0 rounded-[5px] bg-action px-4 text-[11px] text-on-action"
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
                          disabled={saving}
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
                  </div>
                ) : null}
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
      {plan.overBudget ? (
        <p role="alert" className="text-[13px] leading-snug text-danger">
          That is over the {money(view.room.budgetPerHeadCents)} each you set. Swap a stop, or
          go anyway.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-[13px] leading-snug text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <Plate
          variant="action"
          center
          label={booking ? "Booking…" : "Book it"}
          sub="Settles the plan for everyone — no more swaps after this."
          disabled={booking}
          onClick={() => void bookIt()}
        />
        <p className="text-[12px] leading-snug text-dim">
          Booking here is simulated: no table is held and no venue is contacted. Costs are
          estimates, not quotes.
        </p>
      </div>
    </section>
  );
}
