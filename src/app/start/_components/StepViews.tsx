import type { RefObject } from "react";
import { api } from "@convex/_generated/api";
import { QUIZ_CARDS } from "@convex/lib/account/quiz";
import type { Mood } from "@convex/lib/deck/scoring";
import { Plate } from "@/components/questly/Plate";
import { Chip } from "@/components/questly/Chip";
import { roomWhenLabel } from "@/lib/start/when";
import {
  BUDGETS,
  HEADCOUNTS,
  RADII,
  type FunnelDraft,
  type Step,
} from "@/lib/start/funnel";
import {
  WHEN_IDS,
  WHEN_LABELS,
  dateToInputValue,
  inputValueToMinutes,
  isValidDateValue,
} from "@/lib/start/when";
import type { UsePaginatedQueryReturnType } from "convex/react";

const MOODS: Array<{ id: Mood; label: string; sub: string }> = [
  { id: "grass", label: "Touch grass", sub: "Outside, free, no booking needed." },
  { id: "sidequest", label: "Random crazy sidequests", sub: "The theme park nobody has been to since 1994." },
  { id: "hangout", label: "Hang-outs", sub: "One long table, or somewhere loud." },
];

const TOTAL_QUESTIONS = QUIZ_CARDS.length;
type OpenRooms = UsePaginatedQueryReturnType<typeof api.rooms.openRoomsPage>;

export type StepViewsProps = {
  current: Step;
  headingRef: RefObject<HTMLHeadingElement | null>;
  cardIndex: number;
  answers: FunnelDraft["answers"];
  mood: FunnelDraft["mood"];
  visibility: FunnelDraft["visibility"];
  headcount: FunnelDraft["headcount"];
  budget: FunnelDraft["budget"];
  whenId: FunnelDraft["whenId"];
  whenValue: string;
  whenDate: FunnelDraft["whenDate"];
  radiusKm: FunnelDraft["radiusKm"];
  busy: boolean;
  lookingForRoom: boolean;
  openRooms: OpenRooms;
  edit: (patch: Partial<FunnelDraft>) => void;
  goTo: (next: Step, patch?: Partial<FunnelDraft>) => void;
  finishQuiz: (answers: FunnelDraft["answers"]) => Promise<void>;
  openTheRoom: () => Promise<void>;
  joinOpenRoom: (code: string) => Promise<void>;
};

function QuizStep({
  headingRef,
  cardIndex,
  answers,
  busy,
  edit,
  finishQuiz,
}: StepViewsProps) {
  return (
    <section aria-labelledby="quiz-heading" className="flex flex-col gap-6">
      <div>
        <p className="board text-[11px] text-accent">
          Question <span className="num">{cardIndex + 1}</span> of{" "}
          <span className="num">{TOTAL_QUESTIONS}</span>
        </p>
        <h1
          id="quiz-heading"
          ref={headingRef}
          tabIndex={-1}
          className="display mt-3 text-[34px] text-text lg:text-[44px]"
        >
          More likely, or less likely?
        </h1>
      </div>

      <p aria-live="polite" className="text-[19px] leading-snug text-text lg:text-[23px]">
        {QUIZ_CARDS[cardIndex].text}
      </p>

      <div className="flex flex-col gap-2">
        {(["more", "less"] as const).map((dir) => (
          <Plate
            key={dir}
            variant="raised"
            label={dir === "more" ? "More likely" : "Less likely"}
            disabled={busy}
            onClick={() => {
              const answered = { ...answers, [QUIZ_CARDS[cardIndex].id]: dir };
              if (cardIndex + 1 < QUIZ_CARDS.length) {
                edit({ answers: answered, step: "quiz", cardIndex: cardIndex + 1 });
              } else void finishQuiz(answered);
            }}
          />
        ))}
      </div>
    </section>
  );
}

function MoodStep({ headingRef, mood, goTo }: StepViewsProps) {
  return (
    <section aria-labelledby="mood-heading" className="flex flex-col gap-6">
      <h1
        id="mood-heading"
        ref={headingRef}
        tabIndex={-1}
        className="display text-[38px] text-text lg:text-[48px]"
      >
        What kind of night?
      </h1>
      {/* Two columns from `lg` and not `auto-fit`: there are exactly four
          moods, and every auto-fit track that fits this measure lands on three
          columns, which leaves one mood alone on a second row looking like an
          afterthought. Two-by-two is the same block the constraints step
          already draws, and the four options stay visibly equal -- which they
          are, since this is the one question with no wrong answer.

          Mobile classes first and unchanged: below `lg` this is the same
          `flex flex-col gap-2` stack it has always been. */}
      <div className="flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:gap-3">
        {MOODS.map((m) => (
          <Plate
            key={m.id}
            variant="raised"
            selected={m.id === mood}
            label={m.label}
            sub={m.sub}
            // Only the activity. Who is coming -- and therefore whether the
            // room is open to strangers -- is the next screen's question, and
            // used to be answered twice in two different vocabularies.
            onClick={() => goTo("party", { mood: m.id })}
          />
        ))}
      </div>
    </section>
  );
}

function PartyStep({
  headingRef,
  visibility,
  busy,
  lookingForRoom,
  openRooms,
  edit,
  goTo,
  joinOpenRoom,
}: StepViewsProps) {
  return (
    <section aria-labelledby="party-heading" className="flex flex-col gap-6">
      <h1
        id="party-heading"
        ref={headingRef}
        tabIndex={-1}
        className="display text-[38px] text-text lg:text-[48px]"
      >
        Who is coming?
      </h1>

      <div className="flex flex-col gap-2">
        <Plate
          variant="raised"
          label="With friends"
          sub="Open a room and send them the number."
          disabled={busy}
          onClick={() => goTo("constraints", { visibility: "private" })}
        />
        <Plate
          variant="raised"
          label="Just me"
          sub="A solo sidequest. Same plan, no voting."
          disabled={busy}
          onClick={() => goTo("constraints", { visibility: "private", headcount: 1 })}
        />
        <Plate
          variant="raised"
          selected={visibility === "open"}
          label="Meet people"
          sub="Join a room that is already open."
          disabled={busy}
          onClick={() => edit({ visibility: "open" })}
        />
      </div>

      <p aria-live="polite" className="sr-only">
        {!lookingForRoom
          ? ""
          : openRooms.results.length === 0 && openRooms.status !== "Exhausted"
            ? "Looking for open rooms."
            : openRooms.results.length === 0
              ? "No rooms are open for this mood yet. You can open one others can join."
              : `${openRooms.results.length} open ${openRooms.results.length === 1 ? "room" : "rooms"} for this mood.`}
      </p>

      {lookingForRoom ? (
        <div className="flex flex-col gap-2">
          <h2 className="board text-[11px] text-accent">Open rooms right now</h2>
          {openRooms.results.length === 0 && openRooms.status !== "Exhausted" ? (
            <p className="text-[13px] text-dim">Looking…</p>
          ) : (
            <>
              {openRooms.results.length === 0 ? (
                <p className="text-[13px] text-dim">Nobody has a room open for this mood yet.</p>
              ) : (
                <>
                  {openRooms.results.map((room) => (
                    <Plate
                      key={room.code}
                      variant="raised"
                      label={`Room ${room.code}`}
                      sub={
                        room.demo
                          ? `Demonstration room · ${room.memberCount} of ${room.headcount} in`
                          : `${room.memberCount} of ${room.headcount} in`
                      }
                      right={roomWhenLabel(room.whenAt)}
                      disabled={busy}
                      onClick={() => void joinOpenRoom(room.code)}
                    />
                  ))}
                  {openRooms.results.some((room) => room.demo) ? (
                    <p className="text-[12px] leading-snug text-dim">
                      Rooms marked as demonstration rooms are seeded examples, not other people
                      waiting.
                    </p>
                  ) : null}
                  {openRooms.status === "CanLoadMore" ? (
                    <Plate
                      variant="action"
                      label="Show more rooms"
                      disabled={busy}
                      onClick={() => openRooms.loadMore(8)}
                    />
                  ) : openRooms.status === "LoadingMore" ? (
                    <p className="text-[13px] text-dim">Looking for more rooms…</p>
                  ) : null}
                </>
              )}

              <Plate
                variant="action"
                label={openRooms.results.length === 0 ? "Open one others can join" : "Open your own instead"}
                sub={openRooms.results.length === 0 ? undefined : "It joins this list, so strangers can find it too."}
                disabled={busy}
                onClick={() => goTo("constraints")}
              />
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

function ConstraintsStep({
  headingRef,
  headcount,
  budget,
  whenId,
  whenValue,
  whenDate,
  radiusKm,
  busy,
  edit,
  openTheRoom,
}: StepViewsProps) {
  return (
    <section aria-labelledby="constraints-heading" className="flex flex-col gap-7">
      <h1
        id="constraints-heading"
        ref={headingRef}
        tabIndex={-1}
        className="display text-[38px] text-text lg:text-[48px]"
      >
        Four answers and it is solved.
      </h1>

      {/* Four questions, two columns from `lg`. These are chip groups, not a
          list of stops, so a grid here is not the card grid DESIGN.md rules
          out -- the rule protects list-like SCREENS whose answer is the route
          line, and this screen's answer is four constraints taken at once.
          Two columns is what stops the wide shell from being four rows of
          chips with 600px of nothing beside them.

          The mobile classes are stated first and unchanged: below `lg` this
          div is the same `flex flex-col gap-7` the section already applied to
          these four fieldsets as direct children, so the phone spacing is
          byte-for-byte what it was. */}
      <div className="flex flex-col gap-7 lg:grid lg:grid-cols-2 lg:gap-x-10 lg:gap-y-7">
        <fieldset className="flex flex-col gap-3 border-0 p-0">
          <legend className="board text-[11px] text-accent">How many</legend>
          <div className="flex flex-wrap gap-2">
            {HEADCOUNTS.map((n) => (
              <Chip key={n} selected={headcount === n} onClick={() => edit({ headcount: n })}>
                {n === 1 ? "Just me" : n}
              </Chip>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3 border-0 p-0">
          <legend className="board text-[11px] text-accent">Budget per head</legend>
          <div className="flex flex-wrap gap-2">
            {BUDGETS.map((cents) => (
              <Chip key={cents} selected={budget === cents} onClick={() => edit({ budget: cents })}>
                {cents === 0 ? "$0" : `$${cents / 100}`}
              </Chip>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3 border-0 p-0">
          <legend className="board text-[11px] text-accent">When</legend>
          <div className="flex flex-wrap gap-2">
            {WHEN_IDS.map((id) => (
              <Chip
                key={id}
                selected={whenId === id}
                /* Picking a day seeds the field with today, so the chip never
                   opens onto an empty date that resolves to a day nobody
                   chose. `new Date()` is safe in a click handler for the
                   reason it is not safe in this file's render: nothing here
                   has to match server-rendered HTML.

                   `whenDate ?? ...` and not a plain assignment, because
                   coming back to the chip after moving off it should return
                   the day already chosen rather than reset to today. */
                onClick={() =>
                  edit({
                    whenId: id,
                    whenMinutes: null,
                    whenDate: id === "custom" ? (whenDate ?? dateToInputValue(new Date())) : null,
                  })
                }
              >
                {WHEN_LABELS[id]}
              </Chip>
            ))}
          </div>
          {/* The date only when a date was asked for. The three presets NAME
              their day -- a date field beside "Tomorrow" is either redundant
              or a second answer contradicting the first. `flex-wrap` because
              a date and a time together need about 300px, which is more than
              this fieldset gets in the two-column layout at `lg`. */}
          <div className="flex flex-wrap items-center gap-3">
            {whenId === "custom" ? (
              <label className="flex items-center gap-3 text-[13px] text-dim">
                On
                <input
                  type="date"
                  value={whenDate ?? ""}
                  onChange={(e) =>
                    edit({
                      whenDate: isValidDateValue(e.target.value) ? e.target.value : null,
                    })
                  }
                  className="num min-h-[44px] min-w-[44px] rounded-[5px] border border-dim bg-transparent px-3 py-2 text-[14px] text-text"
                />
              </label>
            ) : null}
            <label className="flex items-center gap-3 text-[13px] text-dim">
              Start at
              <input
                type="time"
                value={whenValue}
                onChange={(e) => edit({ whenMinutes: inputValueToMinutes(e.target.value) })}
                className="num min-h-[44px] min-w-[44px] rounded-[5px] border border-dim bg-transparent px-3 py-2 text-[14px] text-text"
              />
            </label>
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3 border-0 p-0">
          <legend className="board text-[11px] text-accent">How far</legend>
          <div className="flex flex-wrap gap-2">
            {RADII.map((km) => (
              <Chip key={km} selected={radiusKm === km} onClick={() => edit({ radiusKm: km })}>
                {km} km
              </Chip>
            ))}
          </div>
          <p className="text-[12px] text-dim">Measured from the Melbourne CBD.</p>
        </fieldset>
      </div>

      <Plate
        variant="action"
        label={busy ? "Opening…" : "Open the room"}
        disabled={busy}
        onClick={() => void openTheRoom()}
      />
    </section>
  );
}

export function StepViews(props: StepViewsProps) {
  switch (props.current) {
    case "quiz":
      return <QuizStep {...props} />;
    case "mood":
      return <MoodStep {...props} />;
    case "party":
      return <PartyStep {...props} />;
    case "constraints":
      return <ConstraintsStep {...props} />;
  }
}
