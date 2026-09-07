import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { needed } from "./access";

/**
 * The two rules a host may set on their own room: how long a card stays on
 * screen, and who has to agree before the night is settled.
 *
 * Both live here rather than in the screens that draw them because both are
 * enforced on the server and offered on the client, and an allow-list that
 * exists twice is an allow-list that will disagree with itself. `/start` and
 * the lobby import the option arrays; `rooms.setRules` imports the validators
 * built from the same numbers.
 */

/** Who has to say yes before `bookings.confirm` writes the booking. */
export const FINALIZE_RULES = ["anyone", "host", "majority", "all"] as const;
export type FinalizeRule = (typeof FINALIZE_RULES)[number];

/**
 * What a room does when nobody has chosen.
 *
 * "anyone" is the behaviour this product already shipped, and `bookings.confirm`
 * argues for it in prose: "whoever is holding their phone when the group agrees
 * should not have to hand it to the host". A vote is a thing a host turns ON
 * for a group that wants one -- retiring an existing decision silently, for
 * every room already open, is not something a new feature gets to do.
 */
export const DEFAULT_FINALIZE_RULE: FinalizeRule = "anyone";

/** Seconds a single card stays up before it passes itself. 0 is no timer. */
export const SWIPE_SECONDS_OPTIONS = [0, 15, 30, 60, 120] as const;

/** How long a finalize vote stays open. 0 is no deadline at all. */
export const FINALIZE_SECONDS_OPTIONS = [0, 60, 300, 900] as const;

export const finalizeRuleValidator = v.union(
  v.literal("anyone"),
  v.literal("host"),
  v.literal("majority"),
  v.literal("all"),
);

/**
 * Literal unions, not `v.number()` with a range check: the set of offered
 * values IS the validation, so there is no second place for the two to drift
 * apart. The schema columns stay plain optional numbers on purpose -- a room
 * written before this existed, or under an option we later retire, must still
 * load.
 */
export const swipeSecondsValidator = v.union(
  v.literal(0),
  v.literal(15),
  v.literal(30),
  v.literal(60),
  v.literal(120),
);

export const finalizeSecondsValidator = v.union(
  v.literal(0),
  v.literal(60),
  v.literal(300),
  v.literal(900),
);

/**
 * How many yes votes settle the night.
 *
 * "majority" reuses `needed` -- the same strict majority a stop swap already
 * needs -- rather than writing a second majority that could round differently.
 * "anyone" and "host" are both one person, and which person that is is decided
 * by the caller, not here.
 */
export function votesNeeded(rule: FinalizeRule, members: number): number {
  if (rule === "all") return members;
  if (rule === "majority") return needed(members);
  return 1;
}

/** When an open vote runs out, or null when it never does. */
export function voteDeadlineAt(startedAt: number | undefined, seconds: number): number | null {
  if (startedAt === undefined || seconds <= 0) return null;
  return startedAt + seconds * 1000;
}

/**
 * A window that has run out counts for nothing.
 *
 * Nothing is scheduled to fire at the deadline, and nothing needs to be: the
 * votes are re-read on the next call either way, so the cheap thing to do is
 * decide the question there. The screen counts the same window down from
 * `deadlineAt` so the two say the same thing at the same moment.
 */
export function voteLapsed(
  startedAt: number | undefined,
  seconds: number,
  now: number,
): boolean {
  const at = voteDeadlineAt(startedAt, seconds);
  return at !== null && now >= at;
}

/**
 * Drop every vote in a room, for the four reasons a tally stops meaning
 * anything: it passed, it ran out, the roster moved under it, or the host
 * changed the rule it was counted against.
 */
export async function clearFinalizeVotes(
  ctx: MutationCtx,
  roomId: Id<"rooms">,
): Promise<void> {
  const votes = await ctx.db
    .query("finalizeVotes")
    .withIndex("by_room", (q) => q.eq("roomId", roomId))
    .collect();
  for (const vote of votes) {
    await ctx.db.delete(vote._id);
  }
}
