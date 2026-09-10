"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { navRoomsModel } from "@/lib/shell/rooms";

/**
 * The rooms you were in, in the column, so getting back into one is a click.
 *
 * WHY IT SUBSCRIBES ITSELF RATHER THAN TAKING PROPS. The rest of the nav takes
 * its values from the route, and `ShellNav` says why: `api.rooms.get` is called
 * exactly once in this app and threading a room through the shell would be a
 * provider around the whole product for three strings. This list is the
 * opposite case. `api.profiles.myRooms` needs nothing from the route -- it is
 * the signed-in account's own rooms, the same answer on every screen -- so one
 * subscription here is one subscription, not one per route, and the route
 * convention about second subscriptions is about a route's OWN data.
 *
 * WHY THE ROWS ARE NOT `Plate`s. `Plate` sets its label in the board treatment,
 * which is uppercase and tracked. Measured in the 236px column: a row leaves
 * about 130px beside a four-digit code, and "Treat yourself" needs roughly
 * 150px tracked -- it wrapped. These are contents rather than sections anyway,
 * so sentence case at 13px is the honest hierarchy as well as the one that
 * fits: the six section rows above stay the navigation, and this is a list
 * under them.
 *
 * WHY NOTHING RENDERS UNTIL THERE IS SOMETHING TO SAY. Signed out, `myRooms`
 * returns an empty array; while the query is in flight it is `undefined`. Both
 * render nothing at all rather than a heading over a blank space, so the column
 * does not reserve room for a list that may never arrive.
 */
export function NavRooms({ currentCode }: { currentCode?: string | null }) {
  const rooms = useQuery(api.profiles.myRooms, {});
  if (rooms === undefined || rooms.length === 0) return null;

  const { rows, more } = navRoomsModel(rooms, currentCode);
  if (rows.length === 0) return null;

  return (
    <>
      <p className="board mt-4 mb-[6px] ml-1 text-[10px] text-dim">Your rooms</p>

      <ul className="m-0 flex list-none flex-col gap-[2px] p-0">
        {rows.map((row) => (
          <li key={row.code}>
            <Link
              href={row.href}
              className="flex min-h-[44px] items-center gap-2 rounded-[6px] px-[10px] py-2 text-text"
            >
              {/* `min-w-0` on the growing half and `truncate` on both lines:
                  without the first, a long mood and a long status refuse to
                  shrink and push the code out of the column entirely. */}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px] leading-tight">{row.label}</span>
                <span className="truncate text-[11px] leading-tight text-dim">{row.sub}</span>
              </span>
              <span className="num shrink-0 text-[15px]">{row.code}</span>
            </Link>
          </li>
        ))}
      </ul>

      {/* Only when there are more, and it goes to the full list rather than
          growing this one. The settings screen already lists every room with
          its date, and the column's job is the shortcut, not the archive. */}
      {more > 0 ? (
        <Link
          href="/settings#rooms"
          className="board mt-[2px] ml-[10px] flex min-h-[44px] items-center text-[10px] text-accent"
        >
          {more} more
        </Link>
      ) : null}
    </>
  );
}
