"use client";

import { Suspense, use, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { Plate } from "@/components/questly/Plate";
import { Screen } from "@/components/questly/Screen";
import { isJoinReason, type JoinReason } from "@/lib/room";
import { useSessionKey } from "@/lib/session";
import { errorCode, userMessage } from "@/lib/errors";

/**
 * What the room shell knows and this screen used to not be told.
 *
 * Everybody bounced out of /room landed here and, on a room that had started,
 * read "This room has already started, so it is closed to new people." That is
 * right for a stranger following a link and wrong for both of the people who
 * actually hit it: a member the host has just removed, and a guest whose
 * browser refuses to keep the key that proves they belong. `?from=` says which,
 * and it is validated rather than rendered -- it arrives in a URL anybody can
 * type.
 */
const WHY: Record<JoinReason, string> = {
  "no-key":
    "This device is not holding a seat in this room. That is normal if you have not joined yet — and it also happens when a browser is set to block site storage, in which case joining again gives you a fresh seat.",
  dropped:
    "This room no longer recognises this device. Either the host took the seat back, or the room has moved on without it.",
};

/**
 * The failures where "try again" is not the answer. A full room, a room that
 * has already started swiping and a code that does not exist are all permanent
 * for this visitor, so the sentence is followed by somewhere to go -- a refusal
 * with no way onward is a dead end at the exact moment someone was invited.
 */
const NO_WAY_IN = new Set(["ROOM_FULL", "ROOM_CLOSED", "ROOM_NOT_FOUND"]);

/**
 * The path that keeps a live demo alive: no account, no quiz, one field.
 *
 * Everything else in the product can ask for an account. This screen cannot --
 * it is what someone opens from a group chat while the rest of the room is
 * already swiping.
 */
function JoinForm({ code }: { code: string }) {
  const router = useRouter();
  const from = useSearchParams().get("from");
  const why = isJoinReason(from) ? WHY[from] : null;
  const join = useMutation(api.rooms.join);
  const { sessionKey, store } = useSessionKey(code);

  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showWayOut, setShowWayOut] = useState(false);

  async function submit() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    setShowWayOut(false);
    try {
      // The key this device already holds for this room, when it holds one.
      // `rooms.join` treats it as proof of an existing membership and hands the
      // same row back, so a second tap, a refresh or a re-opened link cannot
      // leave a phantom member sitting in the roster that the room then waits
      // on forever.
      const joined = await join({ code, name, sessionKey: sessionKey ?? undefined });
      store(joined.sessionKey);
      router.push(`/room/${joined.code}`);
    } catch (e) {
      // Never `e.message`: a ConvexError's message is its stringified data, so
      // that would print {"code":"ROOM_FULL",...} at the person.
      setError(userMessage(e, "Could not join that room. Please try again."));
      setShowWayOut(NO_WAY_IN.has(errorCode(e) ?? ""));
      setBusy(false);
    }
  }

  return (
    // The guest journey -- tap a link in a group chat, land here -- never
    // passes the landing page, so this is the only place a guest can reach the
    // day palette or a way into an account.
    <Screen>
      <h1 className="flex flex-col gap-2">
        <span className="board text-[11px] text-accent">Join room</span>
        <span className="num text-[52px] leading-none text-text">{code}</span>
      </h1>

      {why ? <p className="text-[13px] leading-snug text-dim">{why}</p> : null}

      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label htmlFor="join-name" className="board text-[11px] text-accent">
          First name
        </label>
        <input
          id="join-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="given-name"
          maxLength={24}
          // 16px, not smaller: anything under it makes iOS Safari zoom the
          // whole page on focus, and this field is opened one-handed.
          className="min-h-[44px] rounded-[5px] border border-hairline bg-transparent px-3 text-[16px] text-text"
        />
        <p className="text-[12px] leading-snug text-dim">
          No account needed. This is only so the room knows who swiped.
        </p>

        {/* Mounted before its text arrives: a live region inserted into the
            DOM at the moment it has something to say is frequently never
            announced. `empty:-mb-3` takes back the flex gap an empty paragraph
            would leave above the CTA. */}
        <p role="alert" className="text-[13px] leading-snug text-danger empty:-mb-3">
          {error ?? ""}
          {error && showWayOut ? (
            <>
              {" "}
              <Link href="/start" className="text-text underline underline-offset-4">
                Open your own room
              </Link>{" "}
              instead.
            </>
          ) : null}
        </p>

        <Plate
          variant="action"
          center
          label={busy ? "Joining…" : "Join the room"}
          disabled={busy || !name.trim()}
          onClick={() => void submit()}
        />
      </form>
    </Screen>
  );
}

/**
 * `useSearchParams` client-side renders the tree up to the nearest Suspense
 * boundary, so it gets one of its own. `use(params)` stays out here in the page
 * itself, which is where Next 16 hands the route's params in.
 */
export default function JoinPage({ params }: PageProps<"/join/[code]">) {
  const { code } = use(params);
  return (
    <Suspense>
      <JoinForm code={code} />
    </Suspense>
  );
}
