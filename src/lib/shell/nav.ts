/**
 * The rows of the persistent left column, and which one you are standing in.
 *
 * WHY MOST ROWS ARE NOT LINKS. Six rows, three destinations. `/`, `/start` and
 * `/settings` are pages. "Your room", "Voting" and "The plan" are not -- they
 * are three statuses of one room URL, and a room only exists once you are in
 * one. `Concourse` already made this argument for the vertical version and it
 * has not changed: rows that refuse when pressed are worse than rows that never
 * offered. So a row carries an `href` only when there is somewhere to go, and
 * the room rows get one only while a room is open.
 *
 * WHY THE VALUES COME IN AS ARGUMENTS. `useQuery(api.rooms.get)` is called
 * exactly once in this app, in the room route. There is no shared room context
 * and adding one to feed a nav would be a provider around the whole product for
 * three strings. Each route passes what it has; a room row that has nothing to
 * say yet says so with an em dash, which is what the design does too.
 *
 * WHY THREE ROWS CARRY NO VALUE AT ALL. Only the room rows have a number: a
 * code, a deck position, a total. "Tonight", "Start a quest" and "Settings" are
 * pages, and a page has no reading. An em dash there would mean "not known
 * yet", which is not true and never will be -- and it costs the 32px that made
 * "Start a quest" wrap onto two lines in a 236px column.
 */

export type NavRoute = "home" | "start" | "room" | "settings";

/** What the calling route happens to know. Every field is optional by design. */
export type NavContext = {
  /** The open room's code, if the caller is in one. */
  roomCode?: string | null;
  /** The room's status, so the room rows can say which one you are standing in. */
  roomStatus?: "lobby" | "building" | "swiping" | "matched" | "booked" | null;
  /** Your position in the deck, as swiped and total. */
  swiped?: number | null;
  deckSize?: number | null;
  /** The plan's per-head total, already formatted. */
  planTotal?: string | null;
};

export type NavRow = {
  id: string;
  label: string;
  /** A key into `icons.tsx`, resolved by the component. Not a node, so this stays testable. */
  icon: "clock" | "pin" | "people" | "hand" | "swap" | "sliders";
  /** The right-hand value. `null` when the row has no reading to give; never the
   * empty string. An em dash means "not known yet", which only room rows can be. */
  value: string | null;
  selected: boolean;
  /** `null` when there is nowhere to go. */
  href: string | null;
};

const DASH = "—";

/**
 * Which row is standing, given where you are. A room status wins over the route
 * so that the deck highlights "Voting" rather than "Your room" -- the URL is the
 * same for all four, and the row that matches the URL would be right about the
 * address and wrong about the screen.
 */
function selectedId(route: NavRoute, status: NavContext["roomStatus"]): string {
  if (route !== "room") return route;
  switch (status) {
    case "swiping":
    case "building":
      return "voting";
    case "matched":
    case "booked":
      return "plan";
    default:
      return "room";
  }
}

export function navModel(route: NavRoute, ctx: NavContext = {}): NavRow[] {
  const here = selectedId(route, ctx.roomStatus);
  const code = ctx.roomCode ?? null;
  // One href for all three room rows, because they are one page. Absent when
  // there is no room, which is what keeps this from rendering a dead link.
  const roomHref = code ? `/room/${code}` : null;

  const swipeValue =
    ctx.swiped != null && ctx.deckSize != null ? `${ctx.swiped}/${ctx.deckSize}` : DASH;

  return [
    { id: "home", label: "Tonight", icon: "clock", value: null, href: "/" },
    { id: "start", label: "Start a quest", icon: "pin", value: null, href: "/start" },
    { id: "room", label: "Your room", icon: "people", value: code ?? DASH, href: roomHref },
    { id: "voting", label: "Voting", icon: "hand", value: swipeValue, href: roomHref },
    { id: "plan", label: "The plan", icon: "swap", value: ctx.planTotal ?? DASH, href: roomHref },
    { id: "settings", label: "Settings", icon: "sliders", value: null, href: "/settings" },
  ].map((row) => ({ ...row, selected: row.id === here })) as NavRow[];
}
