"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { QUIZ_CARDS, QUIZ_GOALS } from "@convex/lib/quiz";
import type { Mood } from "@convex/lib/scoring";
import { Plate } from "@/components/questly/Plate";
import { Chip } from "@/components/questly/Chip";
import { storeSessionKey } from "@/lib/session";
import { userMessage } from "@/lib/errors";

type Step = "quiz" | "goals" | "mood" | "party" | "constraints";

const MOODS: Array<{ id: Mood; label: string; sub: string }> = [
  { id: "grass", label: "Touch grass", sub: "Outside, free, no booking needed." },
  { id: "meet", label: "Meet people", sub: "Rooms with strangers who showed up too." },
  { id: "treat", label: "Treat yourself", sub: "One good thing, properly." },
  { id: "new", label: "Do something new", sub: "Something you have not done before." },
];

const BUDGETS = [0, 2000, 3000, 5000, 8000];
const HEADCOUNTS = [1, 2, 3, 4, 5, 6];
const RADII = [2, 5, 10, 20];

/**
 * The seven more/less cards plus the goals question. The board line says
 * "question", not "card", because the eighth one is not a card to react to and
 * a counter that says otherwise is a small lie on the first screen anyone sees.
 */
const TOTAL_QUESTIONS = QUIZ_CARDS.length + 1;

/** Where a mis-tap goes back to. The quiz itself is answered forwards only. */
const BACK_TO: Partial<Record<Step, Step>> = { party: "mood", constraints: "party" };

/**
 * Melbourne CBD. Every room is centred here: nothing in this flow asks the
 * browser for a location, because a permission dialog mid-demo is friction
 * nobody asked for and the CBD is the right centre for this audience anyway.
 */
const CBD = { lat: -37.8136, lng: 144.9631 };

/** Tonight 6:30pm, tomorrow 6:30pm, Saturday 2pm -- in the user's own clock. */
function whenOptions(): Array<{ id: string; label: string; at: number }> {
  const at = (dayOffset: number, hour: number, minute: number) => {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, minute, 0, 0);
    return d.getTime();
  };
  const today = new Date().getDay();
  const untilSaturday = (6 - today + 7) % 7 || 7;
  return [
    { id: "tonight", label: "Tonight", at: at(0, 18, 30) },
    { id: "tomorrow", label: "Tomorrow", at: at(1, 18, 30) },
    { id: "weekend", label: "This weekend", at: at(untilSaturday, 14, 0) },
  ];
}

export default function StartPage() {
  const router = useRouter();
  const profile = useQuery(api.profiles.me, {});
  const saveQuiz = useAction(api.profiles.saveQuiz);
  const createRoom = useMutation(api.rooms.create);
  const joinRoom = useMutation(api.rooms.join);

  const [step, setStep] = useState<Step | null>(null);
  const [answers, setAnswers] = useState<Record<string, "more" | "less">>({});
  const [cardIndex, setCardIndex] = useState(0);
  const [goals, setGoals] = useState<string[]>([]);
  const [mood, setMood] = useState<Mood>("grass");
  const [visibility, setVisibility] = useState<"private" | "open">("private");
  const [headcount, setHeadcount] = useState(4);
  const [budget, setBudget] = useState(0);
  const [radiusKm, setRadiusKm] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One source for the three times on offer. State holds the id, never a second
  // copy of the option, so the timestamp sent to the server is always the one
  // rendered next to the label.
  const whens = useMemo(() => whenOptions(), []);
  const [whenId, setWhenId] = useState(whens[0].id);
  const when = whens.find((w) => w.id === whenId) ?? whens[0];

  // The quiz is shown once per account and never again: a returning host lands
  // straight on the mood step.
  const resumeAt: Step | null = profile === undefined ? null : profile ? "mood" : "quiz";
  const current = step ?? resumeAt;

  const lookingForRoom = current === "party" && visibility === "open";
  const openRooms = useQuery(api.rooms.openRooms, lookingForRoom ? { mood } : "skip");

  function toggleGoal(id: string) {
    // Multi-select: leaving with a new name in your phone and coming back
    // calmer are not mutually exclusive.
    setGoals((chosen) =>
      chosen.includes(id) ? chosen.filter((g) => g !== id) : [...chosen, id],
    );
  }

  async function finishQuiz() {
    setBusy(true);
    setError(null);
    try {
      // No displayName: the server refuses one and derives the name from the
      // authenticated identity instead. Goals are required and validated
      // against GOAL_IDS, so only ids from QUIZ_GOALS may be sent.
      await saveQuiz({ answers, goals });
    } catch (e) {
      // A failed embedding must not block the night -- the room works without
      // it, only the recommendations get blunter. Degraded, so it is logged.
      console.warn("saveQuiz failed; continuing without a taste vector", e);
    } finally {
      setBusy(false);
      setStep("mood");
    }
  }

  async function openTheRoom() {
    setBusy(true);
    setError(null);
    try {
      const { code, sessionKey } = await createRoom({
        mood,
        headcount,
        budgetPerHeadCents: budget,
        whenAt: when.at,
        centreLat: CBD.lat,
        centreLng: CBD.lng,
        radiusKm,
        visibility,
        hostName: profile?.displayName ?? "Host",
      });
      storeSessionKey(code, sessionKey);
      router.push(`/room/${code}`);
    } catch (e) {
      setError(userMessage(e, "Could not open the room. Please try again."));
      setBusy(false);
    }
  }

  async function joinOpenRoom(code: string) {
    setBusy(true);
    setError(null);
    try {
      const joined = await joinRoom({ code, name: profile?.displayName ?? "Someone" });
      storeSessionKey(joined.code, joined.sessionKey);
      router.push(`/room/${joined.code}`);
    } catch (e) {
      setError(userMessage(e, "Could not join that room. Please try again."));
      setBusy(false);
    }
  }

  if (current === null) {
    return (
      <main className="flex flex-1 items-center justify-center bg-ground">
        <p className="board text-[11px] text-accent">Loading…</p>
      </main>
    );
  }

  const backTo = BACK_TO[current];

  return (
    <main className="mx-auto flex w-full max-w-[460px] flex-1 flex-col gap-8 bg-ground px-5 py-10">
      {error ? <p role="alert" className="text-[13px] text-danger">{error}</p> : null}

      {/* Mood and party are single-tap decisions with no confirm, so a mis-tap
          otherwise strands you: nothing later in the flow returns to them. */}
      {backTo ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => setStep(backTo)}
          className="board min-h-[44px] self-start text-[11px] text-accent underline underline-offset-4 disabled:pointer-events-none disabled:opacity-50"
        >
          Back
        </button>
      ) : null}

      {current === "quiz" ? (
        <section aria-labelledby="quiz-heading" className="flex flex-col gap-6">
          <div>
            <p className="board text-[11px] text-accent">
              Question <span className="num">{cardIndex + 1}</span> of{" "}
              <span className="num">{TOTAL_QUESTIONS}</span>
            </p>
            <h1 id="quiz-heading" className="display mt-3 text-[34px] text-text">
              More likely, or less likely?
            </h1>
          </div>

          {/* The heading never changes, only the card does -- so the card is
              what gets announced when it turns over. */}
          <p aria-live="polite" className="text-[19px] leading-snug text-text">
            {QUIZ_CARDS[cardIndex].text}
          </p>

          <div className="flex flex-col gap-2">
            {(["more", "less"] as const).map((dir) => (
              <Plate
                key={dir}
                variant={dir === "more" ? "action" : "raised"}
                label={dir === "more" ? "More likely" : "Less likely"}
                onClick={() => {
                  setAnswers({ ...answers, [QUIZ_CARDS[cardIndex].id]: dir });
                  if (cardIndex + 1 < QUIZ_CARDS.length) setCardIndex(cardIndex + 1);
                  else setStep("goals");
                }}
              />
            ))}
          </div>
        </section>
      ) : null}

      {current === "goals" ? (
        <section aria-labelledby="goals-heading" className="flex flex-col gap-6">
          <div>
            <p className="board text-[11px] text-accent">
              Question <span className="num">{TOTAL_QUESTIONS}</span> of{" "}
              <span className="num">{TOTAL_QUESTIONS}</span>
            </p>
            <h1 id="goals-heading" className="display mt-3 text-[34px] text-text">
              What is the night for?
            </h1>
          </div>

          <fieldset className="flex flex-col gap-3 border-0 p-0">
            <legend className="board text-[11px] text-accent">Pick as many as are true</legend>
            <div className="flex flex-wrap gap-2">
              {QUIZ_GOALS.map((goal) => (
                <Chip
                  key={goal.id}
                  selected={goals.includes(goal.id)}
                  onClick={() => toggleGoal(goal.id)}
                >
                  {goal.text}
                </Chip>
              ))}
            </div>
          </fieldset>

          <p className="text-[12px] leading-snug text-dim">
            These shape what we suggest. Picking none is a fine answer — the seven
            cards already said plenty.
          </p>

          <Plate
            variant="action"
            label={
              busy
                ? "Working it out…"
                : goals.length === 0
                  ? "Nothing in particular"
                  : "That is the night"
            }
            disabled={busy}
            onClick={() => void finishQuiz()}
          />
        </section>
      ) : null}

      {current === "mood" ? (
        <section aria-labelledby="mood-heading" className="flex flex-col gap-6">
          <h1 id="mood-heading" className="display text-[38px] text-text">What kind of night?</h1>
          <div className="flex flex-col gap-2">
            {MOODS.map((m) => (
              <Plate
                key={m.id}
                variant={m.id === mood ? "action" : "raised"}
                label={m.label}
                sub={m.sub}
                onClick={() => {
                  setMood(m.id);
                  // "Meet people" is the one mood whose entire point is strangers.
                  setVisibility(m.id === "meet" ? "open" : "private");
                  setStep("party");
                }}
              />
            ))}
          </div>
        </section>
      ) : null}

      {current === "party" ? (
        <section aria-labelledby="party-heading" className="flex flex-col gap-6">
          <h1 id="party-heading" className="display text-[38px] text-text">Who is coming?</h1>

          <div className="flex flex-col gap-2">
            <Plate
              variant="raised"
              label="With friends"
              sub="Open a room and send them the number."
              onClick={() => { setVisibility("private"); setStep("constraints"); }}
            />
            <Plate
              variant="raised"
              label="Just me"
              sub="A solo sidequest. Same plan, no voting."
              onClick={() => { setVisibility("private"); setHeadcount(1); setStep("constraints"); }}
            />
            <Plate
              variant="raised"
              selected={visibility === "open"}
              label="Meet people"
              sub="Join a room that is already open."
              onClick={() => setVisibility("open")}
            />
          </div>

          {lookingForRoom ? (
            <div className="flex flex-col gap-2">
              <h2 className="board text-[11px] text-accent">Open rooms right now</h2>
              {openRooms === undefined ? (
                <p className="text-[13px] text-dim">Looking…</p>
              ) : openRooms.length === 0 ? (
                <>
                  <p className="text-[13px] text-dim">
                    Nobody has a room open for this mood yet.
                  </p>
                  <Plate
                    variant="action"
                    label="Open one others can join"
                    onClick={() => setStep("constraints")}
                  />
                </>
              ) : (
                <>
                  {openRooms.map((room) => (
                    <Plate
                      key={room.code}
                      variant="raised"
                      label={`Room ${room.code}`}
                      sub={
                        room.demo
                          ? `Demonstration room · ${room.memberCount} of ${room.headcount} in`
                          : `${room.memberCount} of ${room.headcount} in`
                      }
                      right={new Date(room.whenAt).toLocaleTimeString("en-AU", {
                        hour: "numeric", minute: "2-digit",
                      })}
                      disabled={busy}
                      onClick={() => void joinOpenRoom(room.code)}
                    />
                  ))}
                  {openRooms.some((room) => room.demo) ? (
                    <p className="text-[12px] leading-snug text-dim">
                      Rooms marked as demonstration rooms are seeded examples, not
                      other people waiting.
                    </p>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
        </section>
      ) : null}

      {current === "constraints" ? (
        <section aria-labelledby="constraints-heading" className="flex flex-col gap-7">
          <h1 id="constraints-heading" className="display text-[38px] text-text">
            Four answers and it is solved.
          </h1>

          <fieldset className="flex flex-col gap-3 border-0 p-0">
            <legend className="board text-[11px] text-accent">How many</legend>
            <div className="flex flex-wrap gap-2">
              {HEADCOUNTS.map((n) => (
                <Chip key={n} selected={headcount === n} onClick={() => setHeadcount(n)}>
                  {n === 1 ? "Just me" : n === 6 ? "6+" : n}
                </Chip>
              ))}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-3 border-0 p-0">
            <legend className="board text-[11px] text-accent">Budget per head</legend>
            <div className="flex flex-wrap gap-2">
              {BUDGETS.map((cents) => (
                <Chip key={cents} selected={budget === cents} onClick={() => setBudget(cents)}>
                  {cents === 0 ? "$0" : `$${cents / 100}`}
                </Chip>
              ))}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-3 border-0 p-0">
            <legend className="board text-[11px] text-accent">When</legend>
            <div className="flex flex-wrap gap-2">
              {whens.map((w) => (
                <Chip key={w.id} selected={when.id === w.id} onClick={() => setWhenId(w.id)}>
                  {w.label}
                </Chip>
              ))}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-3 border-0 p-0">
            <legend className="board text-[11px] text-accent">How far</legend>
            <div className="flex flex-wrap gap-2">
              {RADII.map((km) => (
                <Chip key={km} selected={radiusKm === km} onClick={() => setRadiusKm(km)}>
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
      ) : null}
    </main>
  );
}
