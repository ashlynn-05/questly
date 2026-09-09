import type { RefObject } from "react";
import { api } from "@convex/_generated/api";
import { QUIZ_CARDS, QUIZ_GOALS } from "@convex/lib/quiz";
import type { Mood } from "@convex/lib/scoring";
import { Plate } from "@/components/questly/Plate";
import { Chip } from "@/components/questly/Chip";
import { roomWhenLabel } from "@/lib/when";
import {
  BUDGETS,
  HEADCOUNTS,
  RADII,
  type FunnelDraft,
  type Step,
} from "@/lib/funnel";
import { WHEN_IDS, WHEN_LABELS, inputValueToMinutes } from "@/lib/when";
import type { UsePaginatedQueryReturnType } from "convex/react";

const MOODS: Array<{ id: Mood; label: string; sub: string }> = [
  { id: "grass", label: "Touch grass", sub: "Outside, free, no booking needed." },
  { id: "meet", label: "Meet people", sub: "Rooms with strangers who showed up too." },
  { id: "treat", label: "Treat yourself", sub: "One good thing, properly." },
  { id: "new", label: "Do something new", sub: "Something you have not done before." },
];

const TOTAL_QUESTIONS = QUIZ_CARDS.length + 1;
type OpenRooms = UsePaginatedQueryReturnType<typeof api.rooms.openRoomsPage>;

export type StepViewsProps = {
  current: Step;
  headingRef: RefObject<HTMLHeadingElement | null>;
  cardIndex: number;
  answers: FunnelDraft["answers"];
  goals: FunnelDraft["goals"];
  mood: FunnelDraft["mood"];
  visibility: FunnelDraft["visibility"];
  headcount: FunnelDraft["headcount"];
  budget: FunnelDraft["budget"];
  whenId: FunnelDraft["whenId"];
  whenValue: string;
  radiusKm: FunnelDraft["radiusKm"];
  busy: boolean;
  lookingForRoom: boolean;
  openRooms: OpenRooms;
  edit: (patch: Partial<FunnelDraft>) => void;
  goTo: (next: Step, patch?: Partial<FunnelDraft>) => void;
  toggleGoal: (id: string) => void;
  finishQuiz: () => Promise<void>;
  openTheRoom: () => Promise<void>;
  joinOpenRoom: (code: string) => Promise<void>;
};

function QuizStep({
  headingRef,
  cardIndex,
  answers,
  edit,
  goTo,
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
          className="display mt-3 text-[34px] text-text"
        >
          More likely, or less likely?
        </h1>
      </div>

      <p aria-live="polite" className="text-[19px] leading-snug text-text">
        {QUIZ_CARDS[cardIndex].text}
      </p>

      <div className="flex flex-col gap-2">
        {(["more", "less"] as const).map((dir) => (
          <Plate
            key={dir}
            variant="raised"
            label={dir === "more" ? "More likely" : "Less likely"}
            onClick={() => {
              const answered = { ...answers, [QUIZ_CARDS[cardIndex].id]: dir };
              if (cardIndex + 1 < QUIZ_CARDS.length) {
                edit({ answers: answered, step: "quiz", cardIndex: cardIndex + 1 });
              } else goTo("goals", { answers: answered });
            }}
          />
        ))}
      </div>
    </section>
  );
}

function GoalsStep({ headingRef, goals, toggleGoal, busy, finishQuiz }: StepViewsProps) {
  return (
    <section aria-labelledby="goals-heading" className="flex flex-col gap-6">
      <div>
        <p className="board text-[11px] text-accent">
          Question <span className="num">{TOTAL_QUESTIONS}</span> of{" "}
          <span className="num">{TOTAL_QUESTIONS}</span>
        </p>
        <h1
          id="goals-heading"
          ref={headingRef}
          tabIndex={-1}
          className="display mt-3 text-[34px] text-text"
        >
          What is the night for?
        </h1>
      </div>

      <fieldset className="flex flex-col gap-3 border-0 p-0">
        <legend className="board text-[11px] text-accent">Pick as many as are true</legend>
        <div className="flex flex-wrap gap-2">
          {QUIZ_GOALS.map((goal) => (
            <Chip
              key={goal.id}
              face="prose"
              selected={goals.includes(goal.id)}
              onClick={() => toggleGoal(goal.id)}
            >
              {goal.text}
            </Chip>
          ))}
        </div>
      </fieldset>

      <p className="text-[12px] leading-snug text-dim">
        These shape what we suggest. Picking none is a fine answer — the seven cards already said
        plenty.
      </p>

      <Plate
        variant="action"
        label={busy ? "Working it out…" : goals.length === 0 ? "Nothing in particular" : "That is the night"}
        disabled={busy}
        onClick={() => void finishQuiz()}
      />
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
        className="display text-[38px] text-text"
      >
        What kind of night?
      </h1>
      <div className="flex flex-col gap-2">
        {MOODS.map((m) => (
          <Plate
            key={m.id}
            variant="raised"
            selected={m.id === mood}
            label={m.label}
            sub={m.sub}
            onClick={() =>
              goTo("party", {
                mood: m.id,
                visibility: m.id === "meet" ? "open" : "private",
              })
            }
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
        className="display text-[38px] text-text"
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
        className="display text-[38px] text-text"
      >
        Four answers and it is solved.
      </h1>

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
              onClick={() => edit({ whenId: id, whenMinutes: null })}
            >
              {WHEN_LABELS[id]}
            </Chip>
          ))}
        </div>
        <label className="flex items-center gap-3 text-[13px] text-dim">
          Start at
          <input
            type="time"
            value={whenValue}
            onChange={(e) => edit({ whenMinutes: inputValueToMinutes(e.target.value) })}
            className="num min-h-[44px] min-w-[44px] rounded-[5px] border border-dim bg-transparent px-3 py-2 text-[14px] text-text"
          />
        </label>
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
    case "goals":
      return <GoalsStep {...props} />;
    case "mood":
      return <MoodStep {...props} />;
    case "party":
      return <PartyStep {...props} />;
    case "constraints":
      return <ConstraintsStep {...props} />;
  }
}
