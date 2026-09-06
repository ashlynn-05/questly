"use client";

import { useState, type RefObject } from "react";
import { Rail, RailNode } from "@/components/questly/Rail";
import { Plate } from "@/components/questly/Plate";
import type { RoomView } from "./page";

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

  const perHead = booking.headcount > 0 ? booking.totalCents / booking.headcount : 0;

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
          <span className="board text-[11px] text-accent">Booked</span>
          <span className="num flap text-[56px] leading-none text-text">{booking.ref}</span>
        </h1>
      </div>

      <dl className="m-0 flex flex-wrap gap-x-8 gap-y-3">
        <div>
          {/* The figure is the plan's own per-head total, and every cost in that
              plan is an estimate. It is not a price a venue quoted. */}
          <dt className="board text-[10px] text-dim">Est. per head</dt>
          <dd className="num m-0 text-[22px] text-text">{money(perHead)}</dd>
        </div>
        <div>
          <dt className="board text-[10px] text-dim">Going</dt>
          <dd className="num m-0 text-[22px] text-text">{booking.headcount}</dd>
        </div>
      </dl>

      {view.plan ? (
        <div>
          <h2 className="board text-[11px] text-accent">What you agreed</h2>
          <div className="relative mt-4">
            <Rail />
            <ol className="m-0 flex list-none flex-col gap-6 p-0">
              {view.plan.stops.map((stop) => (
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
                </li>
              ))}
            </ol>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        {/* A plain anchor, not a Plate: this leaves the app for Google Maps, and
            it opens in its own tab so the room is still there afterwards. */}
        <a
          href={booking.deepLink}
          target="_blank"
          rel="noreferrer"
          className="board flex min-h-[44px] items-center justify-center rounded-[6px] bg-action px-4 text-[11px] text-on-action"
        >
          Open in Maps<span className="sr-only"> (opens in a new tab)</span>
        </a>

        {view.plan ? (
          <Plate
            variant="raised"
            center
            label="Send it to the group chat"
            onClick={() => void copyTheMessage(view.plan?.shareMessage ?? "")}
          />
        ) : null}

        {copied ? (
          <p aria-live="polite" className="text-[12px] leading-snug break-words text-dim">
            {copied}
          </p>
        ) : null}
      </div>

      <p className="text-[12px] leading-snug text-dim">
        Demonstration booking. No table has been held and no venue has been contacted, and the
        costs above are estimates rather than quotes.
      </p>
    </section>
  );
}
