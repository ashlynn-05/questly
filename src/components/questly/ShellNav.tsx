import { navModel, type NavContext, type NavRoute, type NavRow } from "@/lib/shell/nav";
import { Clock, Hand, People, Pin, Sliders, Swap } from "./icons";
import { NavRooms } from "./NavRooms";
import { Plate } from "./Plate";

/**
 * The persistent column, and the product's first navigation surface.
 *
 * WHY THE PRODUCT HAS NOT HAD ONE. On a phone there is no room for a nav that
 * is always there, so this app navigated by going back to the front door and
 * starting again. A laptop has the room, and a person who has left a room
 * half-voted has had no way back to it except the URL.
 *
 * WHY HALF THE ROWS ARE NOT LINKS. `navModel` decides that and says why. What
 * matters here is that this component does not paper over it: a row with no
 * destination renders as a `<p>`, not as a `Plate` with a dead handler, so it
 * is not in the tab order and does not answer a press.
 *
 * WHY THE ICONS ARE RESOLVED HERE. `navModel` returns a key rather than a node,
 * so the model stays a plain value the DOM-less test suite can assert on. This
 * map is the one place the two meet.
 *
 * WHY IT IS HIDDEN BELOW `lg`. Mobile keeps the layout it has. `hidden` rather
 * than a visual trick, so a phone does not read out a column it cannot see.
 */

const ICONS: Record<NavRow["icon"], (p: { className?: string }) => React.JSX.Element> = {
  clock: Clock,
  pin: Pin,
  people: People,
  hand: Hand,
  swap: Swap,
  sliders: Sliders,
};

export function ShellNav({ route, ctx }: { route: NavRoute; ctx?: NavContext }) {
  const rows = navModel(route, ctx);

  return (
    <nav
      aria-label="Sections"
      data-shell-nav
      className="hidden w-[236px] shrink-0 flex-col gap-[6px] border-r border-hairline px-3 pt-[22px] pb-5 lg:flex"
    >
      {/* Every row overrides the Plate's 16px padding and 12px gap with 10px
          and 8px. Measured, not guessed: at the defaults a 236px column leaves
          116px for a label, "Start a quest" needs 141px and "Your room" beside
          a four-digit code needs 109px, so the long rows wrapped onto a second
          line and broke the column's rhythm. These values leave 115px for the
          worst room row and 157px for the rest. */}
      {rows.map((row) => {
        const Icon = ICONS[row.icon];
        return row.href ? (
          <Plate
            key={row.id}
            href={row.href}
            variant={row.selected ? "raised" : "ghost"}
            selected={row.selected}
            label={row.label}
            right={row.value ?? undefined}
            icon={<Icon className="size-[18px]" />}
            className="!gap-2 !px-[10px]"
          />
        ) : (
          /* No destination, so no control. It still holds the 44px row height
             the rest of the column sits on, or the rows above and below it
             would step in and out as a room opens and closes. */
          <p
            key={row.id}
            className="flex min-h-[44px] items-center gap-2 rounded-[6px] px-[10px] py-3 text-dim"
          >
            <Icon className="size-[18px] shrink-0" />
            <span className="board min-w-0 flex-1 text-[13px]">{row.label}</span>
            {row.value ? <span className="num shrink-0 text-[15px]">{row.value}</span> : null}
          </p>
        );
      })}

      {/* The rooms you have been in, under the six sections rather than among
          them. Six rows say where you can GO; these say what you were doing,
          and mixing the two would make "Voting" and a room called "Touch grass"
          look like the same kind of thing. It subscribes on its own and renders
          nothing when there is nothing to list -- signed out, or a first
          visit -- so the column below is unchanged for anybody who has no
          rooms yet. */}
      <NavRooms currentCode={ctx?.roomCode} />

      {/* Pushes the call to action to the bottom of the column, so it sits in
          the same place whether the window is 700px tall or 1400px. */}
      <div className="min-h-[24px] flex-1" />

      <Plate href="/start" variant="action" label="Start a quest" center className="min-h-[52px]" />

      {/* The disclaimer this product says everywhere it can be read. A nav that
          is on every screen is the one place it only has to be said once. */}
      <p className="mx-1 mt-[14px] text-[11px] leading-snug text-dim">
        Bookings in this build are simulated and always say so.
      </p>
    </nav>
  );
}
