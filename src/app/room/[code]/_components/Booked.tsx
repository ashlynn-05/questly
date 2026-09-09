"use client";

import { useState, type RefObject } from "react";
import { Rail, RailNode } from "@/components/questly/Rail";
import { Plate } from "@/components/questly/Plate";
import { bookedHeadcount } from "@/lib/room/booking";
import { stopMapsUrl, stopsDirectionsUrl } from "@/lib/room/maps";
import type { RoomView } from "../page";
import { MapsLink } from "./MapsLink";

const time = (at: number) =>
  new Date(at).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });

const money = (cents: number) => (cents === 0 ? "Free" : `$${Math.round(cents / 100)}`);

/**
 * The settled night.
 *
 * R62: no lock, no swap, no propose -- not even disabled ones. The server
 * refuses every one of those paths once a booking exists, and a control that
 * exists only to reject the tap is worse than no control. What is left is what
 * the group agreed to, plus the two things anyone still needs: the way there
 * and the message to paste in the chat.
 */
export function Booked({
  view,
  headingRef,
}: {
  view: RoomView;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const booking = view.booking;

  if (!booking) {
    return (
      <section className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-5">
        <h1 ref={headingRef} tabIndex={-1} className="board text-[11px] text-accent">
          Booking it
        </h1>
        <p aria-live="polite" className="text-[15px] leading-snug text-dim">
          Getting the reference…
        </p>
      </section>
    );
  }

  // "Going" is present tense, so it is the live roster. The booking row stays
  // frozen at what was agreed, and when the two differ this screen says both
  // rather than picking one -- see src/lib/booking.ts for the ruling and why
  // recomputing the total instead was the wrong answer.
  const headcount = bookedHeadcount(booking, view.members.length);

  async function copyTheMessage(message: string) {
    try {
      await navigator.clipboard.writeText(message);
      setCopied("Copied. Paste it in the chat.");
    } catch {
      // Some browsers refuse clipboard access outright. The message is the
      // point, so it goes on screen to be copied by hand.
      setCopied(message);
    }
  }

  return (
    <section className="flex flex-col gap-8 px-5 py-10">
      <div>
        <h1 ref={headingRef} tabIndex={-1} className="flex flex-col gap-2">
          <span className="board text-[11px] text-accent">
            Booked <span className="text-dim">· Simulated</span>
          </span>
          <span className="num flap text-[56px] leading-none text-text">{booking.ref}</span>
        </h1>
        {/* At the reference, not under the itinerary. A 56px code flipping into
            view reads as a reservation a venue has confirmed, and the sentence
            that says otherwise used to sit below four stops -- off-screen on a
            phone at first paint, which is exactly where somebody scrolls past
            it and acts on the number. */}
        <p className="mt-3 text-[13px] leading-snug text-dim">
          Demonstration booking. No table has been held and no venue has been contacted —
          this reference is not a reservation.
        </p>
      </div>

      <dl className="m-0 flex flex-wrap gap-x-8 gap-y-3">
        <div>
          {/* The figure is the plan's own per-head total, and every cost in that
              plan is an estimate. It is not a price a venue quoted. */}
          <dt className="board text-[10px] text-dim">Est. per head</dt>
          <dd className="num m-0 text-[22px] text-text">{money(headcount.perHeadCents)}</dd>
          {/* Only when the roster has moved. The estimate is what the group
              agreed to and does not get re-divided behind their backs, so the
              screen has to say what it was divided by -- otherwise this reads
              as what each of the people still going will pay. */}
          {headcount.changed ? (
            <p className="mt-1 max-w-[18ch] text-[11px] leading-snug text-dim">
              Split between <span className="num">{headcount.agreed}</span> when this was
              booked.
            </p>
          ) : null}
        </div>
        <div>
          <dt className="board text-[10px] text-dim">Going</dt>
          <dd className="num m-0 text-[22px] text-text">{headcount.going}</dd>
          {headcount.changed ? (
            <p className="mt-1 max-w-[18ch] text-[11px] leading-snug text-dim">
              <span className="num">{headcount.agreed}</span> were in when the group
              booked.
            </p>
          ) : null}
        </div>
      </dl>

      {view.plan ? (
        <div>
          <h2 className="board text-[11px] text-accent">What you agreed</h2>
          <div className="relative mt-4">
            <Rail />
            <ol className="m-0 flex list-none flex-col gap-6 p-0">
              {view.plan.stops.map((stop) => {
                const where = stopMapsUrl(stop);
                return (
                  <li key={stop.id} className="relative pl-14">
                    <RailNode top={6} state="locked" />
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="min-w-0">
                        <p className="board num text-[10px] text-accent">{time(stop.startAt)}</p>
                        <p className="mt-1 text-[17px] leading-snug text-text">{stop.name}</p>
                        {stop.note ? (
                          <p className="mt-1 text-[13px] leading-snug text-dim">{stop.note}</p>
                        ) : null}
                      </div>
                      <p className="num shrink-0 text-[15px] text-text">
                        {money(stop.costPerHeadCents)}
                      </p>
                    </div>

                    {/* The route link above the fold answers "what is the shape
                        of the night". This answers "where is THAT one" -- the
                        question somebody asks about the 9:30 stop while standing
                        up to leave the 7:45 one, and the route view is the wrong
                        place to go looking for it.

                        `w-fit`, so the 44px target is the link and not the whole
                        row: a full-width control per stop would read as the
                        primary action on a screen whose primary action is the
                        orange button below. Absent when the stop has no name
                        Google could find -- see `stopMapsUrl`. */}
                    {where ? (
                      <MapsLink
                        href={where}
                        className="board mt-2 w-fit border border-hairline text-[10px] text-dim"
                      >
                        Where is it
                      </MapsLink>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        {/* THE ROUTE, not the anchor venue. `booking.deepLink` is built by
            `convex/bookings.ts` from the matched quest alone, so this button
            offered the night and then showed one place -- the group got the
            first stop and had to find the other two themselves.

            The stored `deepLink` is untouched and stays the fallback. It is a
            frozen record of what the room agreed to, and `src/lib/room/
            booking.ts` is a long argument about not rewriting those after the
            fact; this is a better link COMPUTED at render time, not a correction
            applied to history. It also still answers when a plan has no route to
            draw, which is the case `stopsDirectionsUrl` returns null for. */}
        <MapsLink
          href={(view.plan && stopsDirectionsUrl(view.plan.stops)) || booking.deepLink}
          className="board border border-action-edge bg-action text-[11px] text-on-action"
        >
          Open in Maps
        </MapsLink>

        {view.plan ? (
          <Plate
            variant="raised"
            center
            label="Send it to the group chat"
            onClick={() => void copyTheMessage(view.plan?.shareMessage ?? "")}
          />
        ) : null}

        {/* Mounted empty, then filled: a live region inserted into the DOM
            with its text already in it is frequently never announced. */}
        <p aria-live="polite" className="text-[12px] leading-snug break-words text-dim">
          {copied ?? ""}
        </p>
      </div>

      {/* Never a dead end -- and this is the screen the whole funnel exists to
          reach, so it was the worst one to leave without a way onward. Until
          now the only controls here left the app for Google Maps or wrote to
          the clipboard: a host who wanted a second night edited the URL by
          hand. A link, not a button, so it opens in a new tab if they want it
          to and the room stays where it is. */}
      <div className="flex flex-col gap-2 border-t border-hairline pt-6">
        <h2 className="board text-[11px] text-accent">After this</h2>
        <Plate
          variant="raised"
          href="/start"
          label="Plan another night"
          sub="This room stays exactly where it is — the link still works."
        />
      </div>

      <p className="text-[12px] leading-snug text-dim">
        Nothing on this screen has been booked with anybody: no table is held, no venue has
        been contacted, and the reference above is ours, not a venue&rsquo;s. The costs are
        estimates rather than quotes.
      </p>
    </section>
  );
}
