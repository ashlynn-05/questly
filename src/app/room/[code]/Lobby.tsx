"use client";

import { useState, type RefObject } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Plate } from "@/components/questly/Plate";
import { Rail, RailNode } from "@/components/questly/Rail";
import { userMessage } from "@/lib/errors";
import type { RoomView } from "./page";

/**
 * The waiting room. Its whole job is to make the room feel occupied while it
 * fills: the number to read across a table, a seat for everyone who is coming,
 * and a line that fills in as they arrive.
 */
export function Lobby({
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
  const build = useAction(api.deck.build);
  const removeMember = useMutation(api.rooms.removeMember);

  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Id<"members"> | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Empty seats are shown, not hidden: the room is visibly waiting for people.
  // `rooms.join` refuses once the roster reaches `headcount`, so the roster
  // cannot outgrow the seats -- the max is belt and braces, not a real case.
  const seats = Math.max(view.room.headcount, view.members.length);
  const hostName = view.members.find((m) => m.isHost)?.name ?? "The host";

  async function startTheDeck() {
    setBusy(true);
    setError(null);
    try {
      await build({ code, sessionKey });
      // Deliberately no setBusy(false) on success: the room's status changes to
      // "building" in the same breath, which unmounts this screen. Clearing it
      // here would only be a write to a component nobody is looking at.
    } catch (e) {
      setError(userMessage(e, "Could not build the deck. Please try again."));
      setBusy(false);
    }
  }

  async function copyTheLink() {
    const link = `${location.origin}/join/${code}`;
    setError(null);
    try {
      await navigator.clipboard.writeText(link);
      setCopied("Link copied.");
    } catch {
      // Clipboard access is refused outright in some browsers and over plain
      // http. The link itself is the point, so it goes on screen to be read
      // out or typed rather than the failure being swallowed.
      setCopied(`Could not copy it. The link is ${link}`);
    }
  }

  async function remove(memberId: Id<"members">) {
    setError(null);
    setRemoving(null);
    try {
      await removeMember({ code, sessionKey, memberId });
    } catch (e) {
      setError(userMessage(e, "Could not remove them from the room."));
    }
  }

  return (
    <section className="flex flex-col gap-8 px-5 py-10">
      <div>
        <h1 ref={headingRef} tabIndex={-1} className="flex flex-col gap-2">
          <span className="board text-[11px] text-accent">Room</span>
          <span className="num text-[64px] leading-none text-text">{code}</span>
        </h1>
        <p className="mt-3 text-[13px] text-dim">Read this out, or send the link.</p>
      </div>

      {/* The rail sits on the container; every row carries its own node and its
          own left padding, so a row is free to grow (a confirmation, a longer
          name) without the roundels drifting off the line. */}
      <div className="relative">
        <Rail dashed />
        <ul className="m-0 flex list-none flex-col p-0">
          {Array.from({ length: seats }, (_, i) => {
            const member = view.members[i];
            const confirming = member !== undefined && removing === member._id;
            return (
              <li key={member?._id ?? `seat-${i}`} className="relative py-1 pl-14">
                {/* 16px puts the roundel's centre (top + 9.5, for a 13px disc
                    inside a 3px ring) on the centre of the 44px row below its
                    4px of top padding. */}
                <RailNode top={16} state={member ? "locked" : "open"} />
                <div className="flex min-h-[44px] flex-wrap items-center gap-x-3 gap-y-1">
                  {member ? (
                    <span className="text-[16px] text-text">
                      {member.name}
                      {member.isHost ? (
                        <span className="board ml-2 text-[10px] text-accent">Host</span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-[16px] text-dim">Waiting…</span>
                  )}

                  {/* R55: taking someone out of a group plan is socially loaded,
                      so the control says whose seat it is and what pressing it
                      does. Never a bare icon, and never an ambiguous cross.
                      Two steps, because there is no undo -- they would have to
                      be sent the link again. */}
                  {view.you.isHost && member && !member.isHost ? (
                    confirming ? (
                      <span className="flex flex-wrap items-center gap-x-3">
                        <button
                          type="button"
                          onClick={() => void remove(member._id)}
                          className="board min-h-[44px] px-3 text-[11px] text-danger underline underline-offset-4"
                        >
                          Yes, remove {member.name}
                        </button>
                        <button
                          type="button"
                          onClick={() => setRemoving(null)}
                          className="board min-h-[44px] px-3 text-[11px] text-accent underline underline-offset-4"
                        >
                          Keep them
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setRemoving(member._id)}
                        className="board ml-auto min-h-[44px] px-3 text-[11px] text-accent underline underline-offset-4"
                      >
                        Remove {member.name}
                      </button>
                    )
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* The roster changes under people while they are looking elsewhere on
          the screen, so the count is announced rather than only drawn. */}
      <p aria-live="polite" className="sr-only">
        {view.members.length} of {seats} in the room.
      </p>

      <div className="flex flex-col gap-2">
        <Plate variant="raised" label="Copy the join link" onClick={() => void copyTheLink()} />
        {copied ? (
          <p aria-live="polite" className="text-[12px] leading-snug break-words text-dim">
            {copied}
          </p>
        ) : null}

        {view.you.isHost ? (
          <Plate
            variant="action"
            center
            label={busy ? "Building…" : "Start swiping"}
            sub="Nobody else can join once the deck starts."
            disabled={busy}
            onClick={() => void startTheDeck()}
          />
        ) : (
          <p className="text-[13px] text-dim">{hostName} starts the deck.</p>
        )}

        {error ? (
          <p role="alert" className="text-[13px] leading-snug text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
