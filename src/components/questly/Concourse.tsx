import { Rail, RailEnd, RailNode } from "./Rail";

/**
 * The whole night, as one line, in a column of its own.
 *
 * WHY THIS EXISTS. `DESIGN.md` opens by claiming "a route is not a grid" and
 * calls the route line the spine of every list screen. On a phone that line can
 * only ever be decoration beside the content -- there is no room for it to be
 * anything else. A laptop is the first surface where it can be the thing the
 * design system says it is: the stops of the night, all of them, visible from
 * whichever one you are standing on.
 *
 * So the desktop breakpoint does not spend its extra width on gutters. It
 * spends it on the one thing only a wide screen can show, which is where this
 * screen sits in the journey it belongs to.
 *
 * WHY IT IS NOT NAVIGATION, which is the obvious reading of a left column with
 * labels in it. Nothing here is reachable by pressing it. The funnel is
 * answered forwards only -- `BACK_TO` in `/start` allows exactly two moves
 * backwards -- and a room's status is a fact about the room, not a page you
 * visit. Eight links that all refuse would be worse than no links, so this is
 * an ordered list with `aria-current="step"` on the one you are at, and the
 * roundels stay `aria-hidden` decoration exactly as they are everywhere else.
 *
 * WHY IT IS HIDDEN BELOW `lg`. Mobile is unchanged; that is an acceptance
 * criterion, not a preference. `hidden` rather than a visual trick, so it
 * leaves the accessibility tree too -- a phone gets no announcement of a column
 * that is not there.
 *
 * WHERE IT MAY BE PUT. `Rail`, `RailNode` and `RailEnd` all paint with
 * `--ground` (see the note on `--ground` in `globals.css`): the roundel's fill
 * and the line's end-cap are the page colour, so the line reads as passing
 * behind them. Put this column on a raised panel and the mask becomes a stripe
 * and the roundels become dots. It belongs on `Screen`'s own `bg-ground`, with
 * no surface of its own -- which is also why there is no border or panel here.
 */

/**
 * A stop on the night. The funnel's steps and the room's statuses are one
 * journey, so they are one union -- `quiz` and `goals` share a stop because
 * they are one sitting, and `building` shares the swipe stop because it is the
 * deck arriving rather than a place anybody stands.
 */
export type Stop =
  | "quiz"
  | "mood"
  | "party"
  | "constraints"
  | "room"
  | "swiping"
  | "matched"
  | "booked";

/**
 * In order, and the order is the product. Labels are `.board` strings because
 * that is this system's signage role -- a station name on an indicator board,
 * not an invented second eyebrow convention.
 */
const STOPS: { id: Stop; label: string }[] = [
  { id: "quiz", label: "Warm up" },
  { id: "mood", label: "Mood" },
  { id: "party", label: "Party" },
  { id: "constraints", label: "Set up" },
  { id: "room", label: "Room" },
  { id: "swiping", label: "Swipe" },
  { id: "matched", label: "Plan" },
  { id: "booked", label: "Booked" },
];

export function Concourse({ at }: { at: Stop }) {
  /**
   * The quiz is answered once per account and a returning host never sees it,
   * so a permanent "Warm up" stop would draw a journey most people did not
   * take. It appears only while it is the one you are on.
   */
  const stops = STOPS.filter((stop) => stop.id !== "quiz" || at === "quiz");
  const here = stops.findIndex((stop) => stop.id === at);

  return (
    <ol
      // Named, because "list of eight items" is not what this is. The name says
      // what the column is for; `aria-current` below says where you are in it.
      aria-label="Your night"
      className="relative m-0 hidden list-none flex-col p-0 lg:flex"
    >
      <Rail />
      {stops.map((stop, i) => (
        <li
          key={stop.id}
          className="relative py-1 pl-14"
          // The whole point of the column, for anybody not looking at it.
          aria-current={i === here ? "step" : undefined}
        >
          {/* Behind, at, ahead. 16px puts the roundel's centre (top + 9.5, for
              a 13px disc inside a 3px ring) on the centre of the 44px row below
              its 4px of top padding -- the same sum the room roster uses, so
              the two lists sit on the same rhythm. */}
          <RailNode top={16} state={i < here ? "locked" : i === here ? "live" : "open"} />
          {/* The line ends on the last stop rather than running to the bottom
              of the column. BEFORE the node in source order: the cap paints
              `--ground` from the roundel's centre down, and drawn after the
              node it takes a bite out of a hollow roundel's ring. */}
          {i === stops.length - 1 ? <RailEnd top={26} /> : null}
          <p
            // 44px is the row height this product holds everywhere, and it is
            // what keeps the roundels on the ~52px rhythm the rail was drawn
            // for. Nothing here is pressable, so the height is rhythm rather
            // than a target -- but the two have to agree, or a stop in this
            // column would not line up with the same stop on a room screen.
            //
            // Apricot for where you are, dim for everywhere else. Never colour
            // alone: `aria-current` above carries the same fact, and the live
            // roundel's ring and halo carry it visually.
            className={`board flex min-h-[44px] items-center text-[11px] ${
              i === here ? "text-accent" : "text-dim"
            }`}
          >
            {stop.label}
          </p>
        </li>
      ))}
    </ol>
  );
}
