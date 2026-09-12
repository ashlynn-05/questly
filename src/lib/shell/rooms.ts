/**
 * The rooms this account is in, said the same way wherever they are listed.
 *
 * WHY THIS IS A MODULE AND NOT TWO COPIES. `api.profiles.myRooms` returns raw
 * enum strings -- `grass`, `swiping` -- and until now the settings screen was
 * the only place that turned them into words, so the two maps lived in
 * `settings/page.tsx`. The nav now lists the same rooms, and a nav that calls a
 * room "Touch grass" while the settings screen calls it something else is the
 * kind of drift the shell component exists to end.
 *
 * WHY THE NAV'S LIST IS A MODEL RATHER THAN A `.slice()` AT THE CALL SITE.
 * Three decisions live in it -- which room is left out, how many survive, and
 * whether an "all of them" row is needed -- and all three are assertable
 * without a DOM.
 */

/**
 * The mood a room was opened for, in the words the funnel used to ask it.
 *
 * The three the funnel now offers, and only those: `profiles.myRooms` runs
 * every stored mood through `normalizeMood` before it leaves the server, so a
 * room opened under one of the retired ids arrives here as the activity it
 * became. Listing the retired ids as well would be four dead entries pretending
 * the translation had not already happened.
 */
export const MOOD_LABEL: Record<string, string> = {
  grass: "Touch grass",
  sidequest: "Random crazy sidequests",
  hangout: "Hang-outs",
};

/** What a room is doing right now, said plainly enough to decide whether to go back in. */
export const STATUS_LABEL: Record<string, string> = {
  lobby: "Waiting for people",
  building: "Building the deck",
  swiping: "Swiping",
  matched: "Writing the plan",
  booked: "Booked",
};

/** One row of `api.profiles.myRooms`, structurally. */
export type MyRoom = {
  code: string;
  mood: string;
  status: string;
  whenAt: number;
  isHost: boolean;
  demo: boolean;
};

export type NavRoomRow = {
  code: string;
  /** The mood, in words. Sentence case, not the board treatment: see `NavRooms`. */
  label: string;
  /** The status, in words. */
  sub: string;
  href: string;
};

export type NavRoomsModel = {
  rows: NavRoomRow[];
  /** How many did not fit. Zero means the list is all of them. */
  more: number;
};

/**
 * How many rooms the column shows before it stops.
 *
 * Four, and the number is the column's height rather than a preference. The
 * nav is a fixed 236px column whose call to action is pinned to the bottom by a
 * `flex-1` spacer; six section rows, a label and four room rows come to roughly
 * 520px, which still leaves the action visible in a 700px window. A fifth row
 * pushes it under the fold on a laptop, and a list you have to scroll to reach
 * the button under is not a shortcut.
 */
export const NAV_ROOMS_SHOWN = 4;

/**
 * The rooms worth putting in the column, and how many were left out.
 *
 * The room you are STANDING IN is left out on purpose. Its code is already in
 * the column three rows above, on "Your room", and a nav that says 8363 twice
 * in one screen is a nav you have to read twice to be sure they are the same
 * room. Being in a room therefore lets one more of the others through, which is
 * the right trade: the list is for the rooms you are not looking at.
 *
 * The order is the server's and is not re-sorted here: `myRooms` returns the
 * night furthest in the future first, which is what somebody scanning a list of
 * their nights is looking for. Rewriting that in the client would give the two
 * lists two different orders for no reason either could explain.
 */
export function navRoomsModel(
  rooms: readonly MyRoom[],
  currentCode?: string | null,
  shown: number = NAV_ROOMS_SHOWN,
): NavRoomsModel {
  const others = rooms.filter((room) => room.code !== currentCode);
  return {
    rows: others.slice(0, shown).map((room) => ({
      code: room.code,
      label: MOOD_LABEL[room.mood] ?? room.mood,
      sub: room.demo ? "Demonstration room" : (STATUS_LABEL[room.status] ?? room.status),
      href: `/room/${room.code}`,
    })),
    more: Math.max(0, others.length - shown),
  };
}
