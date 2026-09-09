"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

/**
 * Matches HEARTBEAT_MS in `convex/presence.ts`. The component drops a session
 * after 2.5x this, so beating slower than the server expects would grey a
 * phone out while somebody is still looking at it.
 */
const BEAT_MS = 10_000;

/**
 * Which seats have gone quiet.
 *
 * A seat with no presence row at all is NOT away. An older client that never
 * heartbeats, or one whose first beat has not landed, would otherwise be
 * announced to the room as absent on no evidence -- and "Tam left" is exactly
 * the kind of thing a group acts on.
 *
 * Read-only by construction: this returns member ids for the roster to draw,
 * and nothing here reaches `waitingOn`, the match denominator or any threshold.
 * See the header of `convex/presence.ts` for why that boundary is absolute.
 */
export function useAwaySeats(
  code: string,
  sessionKey: string | null,
): ReadonlySet<Id<"members">> {
  const heartbeat = useMutation(api.presence.heartbeat);
  const disconnect = useMutation(api.presence.disconnect);

  // Per tab, so two tabs of the same browser hold two sessions and closing one
  // does not mark the other away.
  //
  // `crypto.randomUUID` is defined only in a secure context, and this runs
  // during the room page's render: on a phone pointed at
  // `http://192.168.1.x:3000` -- which is how this gets demonstrated -- it is
  // undefined and the whole room screen fails to mount, not just the away
  // badges. A session id needs to be unique among a room's open tabs, not
  // unguessable.
  const [sessionId] = useState(
    () =>
      globalThis.crypto?.randomUUID?.() ??
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  );
  const [tokens, setTokens] = useState<{ roomToken: string; sessionToken: string } | null>(null);

  useEffect(() => {
    if (!sessionKey) return;
    let live = true;
    const beat = () => {
      void heartbeat({ code, sessionKey, sessionId })
        // Identity is held steady on an unchanged token: this runs every ten
        // seconds, and a fresh object each time would re-subscribe the query
        // below on every beat.
        .then((next) => {
          if (live) setTokens((prev) => (prev?.sessionToken === next.sessionToken ? prev : next));
        })
        // A missed beat is not worth a message. The next one is ten seconds
        // away, and the only cost of losing them all is a face that stays lit.
        .catch(() => {});
    };
    beat();
    const timer = setInterval(beat, BEAT_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [code, sessionKey, sessionId, heartbeat]);

  useEffect(() => {
    if (!tokens) return;
    const bye = () => void disconnect({ sessionToken: tokens.sessionToken }).catch(() => {});
    // `pagehide` rather than `beforeunload`: it is the one that fires when a
    // phone browser puts the tab into the back/forward cache, which is what
    // closing a tab on iOS actually does. The cleanup covers navigating away
    // inside the app, where nothing unloads at all.
    window.addEventListener("pagehide", bye);
    return () => {
      window.removeEventListener("pagehide", bye);
      bye();
    };
  }, [tokens, disconnect]);

  const list = useQuery(api.presence.list, tokens ? { roomToken: tokens.roomToken } : "skip");

  return useMemo(
    () =>
      new Set(
        (list ?? [])
          .filter((entry) => !entry.online)
          .map((entry) => entry.userId as Id<"members">),
      ),
    [list],
  );
}
