import type { MutableRefObject } from "react";
import { Plate } from "@/components/questly/Plate";
import { clockFace } from "@/lib/room/countdown";
import type { RoomView } from "../page";

type Plan = NonNullable<RoomView["plan"]>;
const money = (cents: number) => (cents === 0 ? "Free" : `$${Math.round(cents / 100)}`);

export function PlanBookingPanel({
  view,
  plan,
  error,
  rule,
  voting,
  voteLapsed,
  votes,
  youVoted,
  hostName,
  secondsToVote,
  booking,
  confirmBook,
  setConfirmBook,
  focusFirstButton,
  restoreBookRef,
  bookRestore,
  bookIt,
  takeItBack,
}: {
  view: RoomView;
  plan: Plan;
  error: string | null;
  rule: RoomView["room"]["finalizeRule"];
  voting: boolean;
  voteLapsed: boolean;
  votes: number;
  youVoted: boolean;
  hostName: string;
  secondsToVote: number | null;
  booking: boolean;
  confirmBook: boolean;
  setConfirmBook: (value: boolean) => void;
  focusFirstButton: (node: HTMLDivElement | null) => void;
  restoreBookRef: MutableRefObject<boolean>;
  bookRestore: (node: HTMLDivElement | null) => void;
  bookIt: () => Promise<void>;
  takeItBack: () => Promise<void>;
}) {
  return (
    <>
      <p role="alert" className="text-[13px] leading-snug text-danger empty:-mb-7">
        {plan.overBudget
          ? `That is over the ${money(view.room.budgetPerHeadCents)} each you set. Swap a stop, or go anyway.`
          : ""}
      </p>
      <p role="alert" className="text-[13px] leading-snug text-danger empty:-mb-7">
        {error ?? ""}
      </p>

      <div className="flex flex-col gap-2">
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

        {rule === "host" && !view.you.isHost ? (
          <p className="text-[13px] leading-snug text-dim">
            {hostName} settles this one. Tell them when you are happy with it.
          </p>
        ) : youVoted ? (
          <>
            <p className="text-[13px] leading-snug text-dim">
              You are in. {rule === "all" ? "Waiting on the rest." : "Waiting on the others."}
            </p>
            <Plate variant="ghost" center label="Take my yes back" onClick={() => void takeItBack()} />
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
                restoreBookRef.current = true;
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
          Booking here is simulated: no table is held and no venue is contacted. Costs are estimates, not quotes.
        </p>
      </div>
    </>
  );
}
