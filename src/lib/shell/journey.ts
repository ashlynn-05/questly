import type { Stop } from "@/components/questly/Concourse";

/**
 * The night as five stages across the top of a laptop screen.
 *
 * WHY THIS IS NOT THE STOP LIST. `Concourse` names eight stops because that is
 * how many distinct places the product has. Five is what fits across the top of
 * a column as a horizontal stepper with legible labels, so the two are not the
 * same list and pretending otherwise would mean either eight cramped labels or
 * a stepper that lies about where you are.
 *
 * The collapse is by sitting, not by convenience. `quiz` and `mood` are one
 * question about what kind of night it is. `constraints` is the four limits.
 * `room` and `swiping` are both "you are in the room" -- the deck arriving is
 * not somewhere anybody stands. `matched` and `booked` are both the plan.
 *
 * WHY IT IS TOTAL. Every member of `Stop` has to land on a stage, or a screen
 * would draw a stepper with nothing live on it and no error to say why. The
 * `satisfies` below is what makes the compiler check that, and the test asserts
 * it again at runtime for the case where somebody widens `Stop` and reaches for
 * a cast to make the build pass.
 */

export type StageState = "locked" | "live" | "open";

export type Stage = {
  id: string;
  label: string;
  state: StageState;
  /** Whether a joining line is drawn to the right of this stage. */
  line: boolean;
};

const STAGES: { id: string; label: string }[] = [
  { id: "mood", label: "Mood" },
  { id: "who", label: "Who" },
  { id: "limits", label: "Limits" },
  { id: "room", label: "Room" },
  { id: "plan", label: "Plan" },
];

/**
 * Which stage each stop stands on. `booked` is the exception and is handled in
 * `journeyModel` rather than here: it is the end of the line, so every stage
 * behind it is done rather than one being live.
 */
const STAGE_OF = {
  quiz: 0,
  mood: 0,
  party: 1,
  constraints: 2,
  room: 3,
  swiping: 3,
  matched: 4,
  booked: 4,
} satisfies Record<Stop, number>;

export function journeyModel(at: Stop): Stage[] {
  const here = STAGE_OF[at];
  return STAGES.map((stage, i) => ({
    ...stage,
    // Booked locks all five. Nothing is "live" once the night is bought:
    // a live stage means there is something left to do on it.
    state: at === "booked" || i < here ? "locked" : i === here ? "live" : "open",
    // The line joins a stage to the next one, so the last stage has none.
    // Drawn as part of the stage rather than between them, because a flex row
    // of five items with four separators is four more chances to mis-align.
    line: i < STAGES.length - 1,
  }));
}

/** The stage count, for a caller that needs to reason about the row's width. */
export const STAGE_COUNT = STAGES.length;
