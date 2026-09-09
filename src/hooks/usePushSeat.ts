"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";

/**
 * Who the SERVER thinks is asking, and how many devices they are listening on.
 *
 * The product has two kinds of person and this is the hook that does not care
 * which: a signed-in caller passes no seat and is identified by their account,
 * a guest passes the room code and `sessionKey` they already hold. Neither
 * decision is made here -- both are passed through and resolved on the server,
 * which is the only place identity can be trusted.
 *
 * Split out of `usePush` because it is the only part with a server in it, and
 * because `PushHint` and the settings toggle want the same answer for different
 * reasons: one to decide whether to ask at all, the other to draw a count.
 */

export type Seat = { code: string; sessionKey: string } | null;

export function usePushSeat(seat: Seat) {
  // Pulled apart into two strings and memoised on those, not on the object.
  // Callers build the seat inline -- `<PushHint seat={{ code, sessionKey }} />`
  // -- so the object is fresh on every render. Passed straight through it would
  // give `useQuery` a new argument each render, and a new subscription with it,
  // and would invalidate every callback built on top of it.
  const code = seat?.code;
  const sessionKey = seat?.sessionKey;
  const args = useMemo(
    () => (code && sessionKey ? { code, sessionKey } : {}),
    [code, sessionKey],
  );

  // NULL AND ZERO ARE DIFFERENT ANSWERS. Zero is "we know who you are and you
  // have no devices" -- draw the toggle, off. Null is "there is nobody here to
  // file a subscription under": signed out, holding no seat. Undefined is only
  // "the query has not come back yet".
  const deviceCount = useQuery(api.push.myDeviceCount, args);

  return {
    args,
    deviceCount: deviceCount ?? 0,
    /** Did the server manage to place this caller at all? */
    identified: typeof deviceCount === "number",
  };
}
