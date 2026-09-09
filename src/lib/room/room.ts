/**
 * The three decisions the room shell makes that no test could reach.
 *
 * `src/app/room/[code]/page.tsx` is a client component, and this project's
 * vitest setup runs one global edge-runtime environment with no DOM -- no
 * jsdom, no testing-library, deliberately. So the shell's redirect split, its
 * "this member is leaving on purpose" suppression and its focus-on-status-
 * change policy were all entirely unexercised, and one of the three was a live
 * defect. They are pure decisions with no React in them, so they live here and
 * are tested like anything else.
 */

/** What `rooms.get` has said so far about this device and this room. */
export type RoomAnswer =
  /** The subscription has not answered yet. */
  | "loading"
  /** The room does not recognise the key this device sent. */
  | "refused"
  /** A room this device is a member of. */
  | "yours";

/**
 * Why somebody was sent to /join, so that /join can say something true.
 *
 * Both cases used to land on the same screen and be told "This room has already
 * started, so it is closed to new people" -- which is right for a stranger and
 * wrong for both of the people who actually hit it.
 */
export type JoinReason =
  /** No key on this device at all: never joined, or the browser refuses to keep one. */
  | "no-key"
  /** A key the room would not take: the host took the seat back, or the room moved on. */
  | "dropped";

export function isJoinReason(value: string | null): value is JoinReason {
  return value === "no-key" || value === "dropped";
}

/**
 * Where the room shell should send this visitor, or null to stay put.
 *
 * Three nothings, not two, and the order matters:
 *
 * - `leaving` wins over everything. Leaving deletes this member's row, so
 *   `rooms.get` answers "refused" in the same breath -- indistinguishable from
 *   a stale key unless the departure is remembered.
 * - `ready` is false until the session store has actually been read. Redirecting
 *   before then bounces every visitor to /join on their first render, including
 *   the ones who are already members.
 * - only then does "the room does not know you" mean anything.
 */
export function roomRedirect({
  code,
  ready,
  hasKey,
  answer,
  leaving,
}: {
  code: string;
  ready: boolean;
  hasKey: boolean;
  answer: RoomAnswer;
  leaving: boolean;
}): string | null {
  if (leaving) return null;
  if (ready && !hasKey) return joinPath(code, "no-key");
  if (answer === "refused") return joinPath(code, "dropped");
  return null;
}

export function joinPath(code: string, reason: JoinReason): string {
  return `/join/${encodeURIComponent(code)}?from=${reason}`;
}

/**
 * Whether a room-status change should pull focus to the new screen's heading.
 *
 * Four of the room's transitions REPLACE the screen and unmount the control
 * that was just pressed, so focus falls to <body> and a keyboard user re-Tabs
 * from the top of the document (WCAG 2.4.3). But the FIRST status this shell
 * sees is the page arriving, not a transition -- grabbing focus there would cut
 * across the browser's own announcement of a freshly loaded document. And a
 * re-run that lands on the same status moved nothing, so it moves nothing:
 * that is also what stops Strict Mode's double-invoked mount effect from
 * stealing focus on arrival.
 *
 * Returns the status to remember as well as the verdict, so the caller never
 * has to work out which of the two to store.
 */
export function statusTransition(
  seen: string | null,
  next: string | null,
): { seen: string | null; moveFocus: boolean } {
  if (next === null) return { seen, moveFocus: false };
  if (seen === next) return { seen, moveFocus: false };
  return { seen: next, moveFocus: seen !== null };
}
