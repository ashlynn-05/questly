"use client";

import { useState, type RefObject } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ConfirmButton } from "@/components/questly/ConfirmButton";
import { Plate } from "@/components/questly/Plate";
import { Rail, RailNode } from "@/components/questly/Rail";
import { errorCode, userMessage } from "@/lib/errors";
import type { BuildFailure, RoomView } from "./page";

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
  buildError,
  setBuildError,
  setLeaving,
}: {
  view: RoomView;
  code: string;
  sessionKey: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  /** Owned by the shell, because this screen unmounts before a build fails. */
  buildError: BuildFailure | null;
  setBuildError: (failure: BuildFailure | null) => void;
  /** Tells the shell not to bounce a departing member back to /join. */
  setLeaving: (value: boolean) => void;
}) {
  const router = useRouter();
  const build = useAction(api.deck.build);
  const removeMember = useMutation(api.rooms.removeMember);
  const leaveRoom = useMutation(api.rooms.leave);

  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Both two-step confirmations on this screen -- and their focus movement in
  // each direction -- live in ConfirmButton. See that file for why.

  // Empty seats are shown, not hidden: the room is visibly waiting for people.
  // `rooms.join` refuses once the roster reaches `headcount`, so the roster
  // cannot outgrow the seats -- the max is belt and braces, not a real case.
  const seats = Math.max(view.room.headcount, view.members.length);
  const hostName = view.members.find((m) => m.isHost)?.name ?? "The host";

  async function startTheDeck() {
    setBusy(true);
    setError(null);
    setBuildError(null);
    try {
      await build({ code, sessionKey });
      // Deliberately no setBusy(false) on success: the room's status changes to
      // "building" in the same breath, which unmounts this screen. Clearing it
      // here would only be a write to a component nobody is looking at.
    } catch (e) {
      // And for exactly that reason the FAILURE goes to the shell, not to
      // local state. Everything thrown after markBuilding commits -- which is
      // every real build failure -- arrives at a dead component; by the time
      // abandonBuild has put the room back in the lobby, this instance is gone
      // and its replacement has an empty error state.
      setBuildError({
        text: userMessage(e, "Could not build the deck. Please try again."),
        code: errorCode(e),
      });
      setBusy(false);
    }
  }

  /**
   * A guest can take themselves out of a room they no longer want to be in.
   *
   * Two steps, for R55's reason: leaving is the same shape of socially loaded,
   * undoable decision as removing somebody, and it moves the same unanimity
   * denominator. Not offered to the host at all -- `rooms.leave` refuses them
   * with HOST_CANNOT_LEAVE, and an orphaned room has nobody to start the deck.
   */
  async function leaveTheRoom(): Promise<"trigger" | "gone"> {
    setError(null);
    // Before the await: leaving deletes this member's row, so `rooms.get`
    // turns null and the shell would otherwise redirect to /join first.
    setLeaving(true);
    try {
      await leaveRoom({ code, sessionKey });
      router.replace("/start");
      // A whole new screen is arriving; focus belongs to it, not here.
      return "gone";
    } catch (e) {
      setLeaving(false);
      setError(userMessage(e, "Could not leave that room. Please try again."));
      return "trigger";
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

  async function remove(memberId: Id<"members">): Promise<"trigger" | "gone"> {
    setError(null);
    try {
      await removeMember({ code, sessionKey, memberId });
      // The row went with them, and so did the button that was just pressed.
      // The roster's live region announces the new count; focus has to go
      // somewhere real rather than to <body>, and the room's heading is the
      // top of the screen this control belongs to.
      headingRef.current?.focus();
      return "gone";
    } catch (e) {
      setError(userMessage(e, "Could not remove them from the room."));
      // They are still in the room, so the control that names them comes back
      // -- and focus goes back onto it.
      return "trigger";
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
            return (
              <li key={member?._id ?? `seat-${i}`} className="relative py-1 pl-14">
                {/* 16px puts the roundel's centre (top + 9.5, for a 13px disc
                    inside a 3px ring) on the centre of the 44px row below its
                    4px of top padding. */}
                <RailNode top={16} state={member ? "locked" : "open"} />
                <div className="flex min-h-[44px] flex-wrap items-center gap-x-3 gap-y-1">
                  {member ? (
                    <span className="flex items-center gap-2 text-[16px] text-text">
                      {/* Only for a member with an account AND a picture --
                          `memberFaces` in convex/lib/roster.ts says why a guest
                          gets the name alone rather than a drawn stand-in. The
                          roundel leads the name inside the same span so the two
                          read as one thing, which is what stops a mixed roster
                          looking like two different lists.

                          `next/image` is wrong here for the reason
                          `AccountBadge` states: Convex signs these URLs per
                          read, so the optimiser has nothing stable to cache and
                          would re-fetch on every roster tick -- and this query
                          ticks on every swipe in the room. */}
                      {member.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={member.avatarUrl}
                          alt=""
                          className="size-[28px] shrink-0 rounded-full border border-action-edge object-cover"
                        />
                      ) : null}
                      {member.name}
                      {member.isHost ? (
                        <span className="board text-[10px] text-accent">Host</span>
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
                    <ConfirmButton
                      className="ml-auto"
                      label={`Remove ${member.name}`}
                      confirmLabel={`Yes, remove ${member.name}`}
                      cancelLabel="Keep them"
                      onConfirm={() => remove(member._id)}
                    />
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
        {/* Mounted empty and filled later, never mounted with its text already
            in it: a live region inserted into the DOM with content is
            frequently not announced at all. */}
        <p aria-live="polite" className="text-[12px] leading-snug break-words text-dim">
          {copied ?? ""}
        </p>

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
          <>
            <p className="text-[13px] text-dim">{hostName} starts the deck.</p>

            <ConfirmButton
              className="self-start"
              label="Leave this room"
              confirmLabel={`Yes, leave room ${code}`}
              cancelLabel="Stay"
              onConfirm={() => leaveTheRoom()}
            />
          </>
        )}

        {/* Two failures, one region, always mounted so both are announced when
            they arrive. `buildError` belongs to the shell because this screen
            does not outlive the build that raises it. */}
        <p
          role="alert"
          className={`text-[13px] leading-snug ${
            !error && buildError?.code === "NO_CANDIDATES" ? "text-dim" : "text-danger"
          }`}
        >
          {error ?? buildError?.text ?? ""}
        </p>

        {/* An honest nothing, not a fault -- and the sentence above tells the
            host to widen the radius or change the mood, neither of which this
            room can do: both were fixed when it was opened. So the way to act
            on that advice goes here, next to it. */}
        {!error && buildError?.code === "NO_CANDIDATES" ? (
          <Link
            href="/start"
            className="board min-h-[44px] self-start px-3 text-[11px] text-accent underline underline-offset-4"
          >
            Open a room with different numbers
          </Link>
        ) : null}
      </div>
    </section>
  );
}
