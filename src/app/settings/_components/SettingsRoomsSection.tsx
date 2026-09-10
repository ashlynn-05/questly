"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { userMessage } from "@/lib/errors";
import { MOOD_LABEL, STATUS_LABEL } from "@/lib/shell/rooms";
import { Plate } from "@/components/questly/Plate";
import { ConfirmButton } from "@/components/questly/ConfirmButton";
import { Section } from "./Section";

/**
 * Every room this account is in, and the one way out of the ones it hosts.
 *
 * WHY CLOSING A ROOM LIVES HERE AND NOT IN THE ROOM. A room whose date was
 * mistyped is a room nobody opens again, so a control inside it is a control
 * behind the very screen you are trying to stop having. This list is where
 * somebody actually meets their old rooms.
 *
 * WHY THE CONTROL IS OFFERED ON EVERY HOSTED ROOM RATHER THAN ONLY THE ONES THE
 * SERVER WOULD ALLOW. `rooms.deleteRoom` refuses a room with other people still
 * in it while the night is ahead, and this screen cannot tell: `myRooms`
 * projects no roster. Guessing would mean either hiding the control on rooms
 * that can in fact be closed, or projecting a member count into a list that
 * does not otherwise need one. The server owns the rule and says so in a
 * sentence, which is what the alert below is for.
 *
 * A demonstration room shows no control at all, because that refusal IS
 * knowable from the row -- `demo` is already projected, and offering a button
 * whose only outcome is a refusal is the pattern `navModel` argues against.
 *
 * `rooms` comes down as a prop and is NOT subscribed to here: the route owns
 * its subscriptions, and an extracted child that opens its own is how one
 * screen ends up watching the same query twice.
 */
export function SettingsRoomsSection({
  rooms,
}: {
  rooms: FunctionReturnType<typeof api.profiles.myRooms> | undefined;
}) {
  const deleteRoom = useMutation(api.rooms.deleteRoom);
  const [error, setError] = useState<string | null>(null);

  async function close(code: string): Promise<"trigger" | "gone"> {
    setError(null);
    try {
      await deleteRoom({ code });
      // The row unmounts as the subscription updates, so there is no trigger
      // left to hand focus back to.
      return "gone";
    } catch (e) {
      setError(userMessage(e, "Could not close that room. Please try again."));
      return "trigger";
    }
  }

  return (
    <Section id="rooms" title="Your rooms" topic="rooms">
      {/* Mounted empty and filled later: a live region inserted into the DOM
          with its text already inside it is frequently never announced. */}
      <p role="alert" className="text-[13px] leading-snug text-danger empty:hidden">
        {error ?? ""}
      </p>

      {rooms === undefined ? (
        <p className="text-[13px] text-dim">Looking…</p>
      ) : rooms.length === 0 ? (
        <p className="text-[13px] leading-snug text-dim">
          No rooms yet. Start one and it will be here.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {rooms.map((room) => (
            /* The control sits BESIDE the plate and not inside it, because the
               plate is a link: a `<button>` nested in an `<a>` is invalid, and
               browsers resolve it by making the whole row ambiguous to press.
               So the row is the flex parent, the link is what grows, and the
               control is its own sibling on the same line as the code.

               `flex-wrap` does two jobs. The armed state is one: "Yes, close it"
               and "Keep it" together need about 200px, which does not fit
               beside a plate in a 446px column, so the pair drops to its own
               line while it is open and the row is one line again the moment it
               closes. The phone is the other -- `w-full` below `sm` takes the
               whole line, because at 338px a plate sharing its row with a 74px
               control has 260px for a label that needs 274px, and the label
               wrapped onto a second line. From `sm` there is room for both and
               they sit together, which is where this control was asked for.

               THE CARD IS THE ROW, NOT THE PLATE. `--ground-raised` moves onto
               this `<li>` and the plate inside it goes transparent, so the
               control shares the surface instead of floating on the page beside
               it -- the row is one card with two targets in it. The plate keeps
               `variant="raised"` rather than `ghost`, because ghost would add a
               hairline border around the half of the card that is a link.

               The control gets the hover, and the plate does not: that is the
               only thing distinguishing a 74px button from the card it sits on
               once they share a background.

               The hover is a BOUNDARY and not a fill, which is a measurement
               rather than a preference. Every ground token that reads as a step
               away from `--ground-raised` in one theme collapses in the other:
               `--ground` is 1.17:1 in night and 1.18:1 in day, `--ground-deep`
               is 1.95:1 in night but 1.08:1 in day -- the day palette's three
               grounds are all near-luminance yellows. `--action` clears both at
               2.5:1, but it is the primary-action fill and this is the one
               destructive control on the screen. `--accent` as an EDGE is
               4.88:1 in night and 8.08:1 in day, far over the 3:1 non-text
               floor in both, and it leaves the label on the surface its own
               contrast was measured against. The border is transparent when
               idle so nothing moves when it appears. */
            <li
              key={room.code}
              className="flex flex-wrap items-center rounded-[6px] bg-ground-raised"
            >
              <Plate
                className="w-full flex-1 !bg-transparent sm:w-auto sm:min-w-[200px]"
                variant="raised"
                href={`/room/${room.code}`}
                label={`${MOOD_LABEL[room.mood] ?? room.mood}${room.isHost ? " · yours" : ""}`}
                sub={`${STATUS_LABEL[room.status] ?? room.status} · ${roomWhen(room.whenAt)}${
                  room.demo ? " · demonstration room" : ""
                }`}
                right={room.code}
              />
              {/* One word, not "Close this room". The row already names the
                  room twice -- its mood and its code -- so the verb is the only
                  new information, and the second step spells the whole thing
                  out before anything happens. */}
              {room.isHost && !room.demo ? (
                <ConfirmButton
                  className="mr-3 shrink-0 rounded-[6px] border border-transparent transition-colors hover:border-accent"
                  label="Close"
                  confirmLabel="Yes, close it"
                  cancelLabel="Keep it"
                  onConfirm={() => close(room.code)}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function roomWhen(at: number): string {
  return new Date(at).toLocaleString("en-AU", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}
