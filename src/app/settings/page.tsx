"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { QUIZ_CARDS, QUIZ_GOALS } from "@convex/lib/quiz";
import { PURGE_WINDOW_DAYS } from "@convex/lib/account";
import { AVATAR_TYPES, MAX_AVATAR_MB, refuseAvatar } from "@convex/lib/avatar";
import { initialsFor } from "@/lib/avatar";
import { authClient } from "@/lib/auth-client";
import { clearLocalState } from "@/lib/signout";
import { userMessage } from "@/lib/errors";
import { Plate } from "@/components/questly/Plate";
import { ConfirmButton } from "@/components/questly/ConfirmButton";
import { Screen, ScreenPending } from "@/components/questly/Screen";
import { Input } from "@/components/ui";

/**
 * The account screen the product did not have.
 *
 * Before this there was no sign-out control anywhere in `src/`, no way to see
 * or change the quiz answers that drive every venue score a person is ever
 * shown, and no way to leave. The room, the deck and the plan were all
 * reachable; the account behind them was not.
 *
 * The current user is read through `api.auth.getCurrentUser` rather than
 * `authClient.useSession()`, because upstream types collapse that hook's `data`
 * to `never` -- `src/app/ConvexClientProvider.tsx` documents it and carries the
 * single assertion this branch allows for it. One Convex subscription is also
 * what the rest of the product already does.
 */

/** The mood a room was opened for, in the words the funnel used to ask it. */
const MOOD_LABEL: Record<string, string> = {
  grass: "Touch grass",
  meet: "Meet people",
  treat: "Treat yourself",
  new: "Something new",
};

/** What a room is doing right now, said plainly enough to decide whether to go back in. */
const STATUS_LABEL: Record<string, string> = {
  lobby: "Waiting for people",
  building: "Building the deck",
  swiping: "Swiping",
  matched: "Writing the plan",
  booked: "Booked",
};

function roomWhen(at: number): string {
  return new Date(at).toLocaleString("en-AU", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function SettingsPage() {
  const router = useRouter();

  const user = useQuery(api.auth.getCurrentUser, {});
  const profile = useQuery(api.profiles.me, {});
  const deletion = useQuery(api.account.deletionStatus, {});
  const rooms = useQuery(api.profiles.myRooms, {});
  const rename = useMutation(api.profiles.renameMe);
  const deleteAccount = useMutation(api.account.deleteAccount);
  const uploadUrl = useMutation(api.profiles.generateAvatarUploadUrl);
  const setAvatar = useMutation(api.profiles.setAvatar);
  const clearAvatar = useMutation(api.profiles.clearAvatar);

  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  /**
   * An account already on its way out belongs on `/restore`, which is the one
   * screen written for that state. Sending it here instead of duplicating the
   * offer keeps the deadline, the wording and the button in one place.
   */
  useEffect(() => {
    if (deletion) router.replace("/restore");
  }, [deletion, router]);

  // The field starts as whatever the profile says and is the user's from then
  // on. Derived during render rather than synced in an effect: `null` means
  // "not typed in yet", so a profile arriving late fills the field once and a
  // half-typed name is never overwritten by a re-render.
  const displayName = name ?? profile?.displayName ?? "";

  async function saveName() {
    const next = displayName.trim();
    if (!next || busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await rename({ displayName: next });
      setSaved(true);
    } catch (e) {
      setError(userMessage(e, "Could not save that name. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Three steps, because the bytes never pass through a Convex function: ask
   * for a URL, POST straight to storage, then hand the id back to be adopted.
   * A mutation cannot take a multi-megabyte argument, and an action relaying
   * them would double the transfer for nothing.
   */
  async function uploadAvatar(file: File | null) {
    if (!file || uploading) return;
    setError(null);

    // Checked here to save a phone spending its upload on a file the server is
    // going to refuse anyway. NOT a rule -- `profiles.setAvatar` checks the
    // stored metadata again, because anything the browser enforces the browser
    // can also skip.
    const refusal = refuseAvatar(file);
    if (refusal === "TYPE") {
      setError("A picture has to be a PNG, JPEG, WebP or GIF.");
      return;
    }
    if (refusal === "SIZE") {
      setError(`A picture has to be under ${MAX_AVATAR_MB}MB.`);
      return;
    }

    setUploading(true);
    try {
      const url = await uploadUrl({});
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!response.ok) throw new Error(`upload failed: ${response.status}`);
      const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
      await setAvatar({ storageId });
    } catch (e) {
      setError(userMessage(e, "Could not save that picture. Please try again."));
    } finally {
      setUploading(false);
      // Cleared so choosing the SAME file again still fires a change event --
      // otherwise a failed upload cannot be retried without picking a
      // different file, which looks like the control is broken.
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function removeAvatar() {
    if (uploading) return;
    setUploading(true);
    setError(null);
    try {
      await clearAvatar({});
    } catch (e) {
      setError(userMessage(e, "Could not remove that picture. Please try again."));
    } finally {
      setUploading(false);
    }
  }

  /**
   * Signing out is three stores, not one.
   *
   * `authClient.signOut()` ends the auth session; `clearLocalState()` drops the
   * two this device holds that no auth library knows about -- the per-room
   * capability tokens and the half-finished funnel draft. Leaving the tokens on
   * a shared laptop would let the next person walk straight back into every
   * room the last one was in (`rooms.get` accepts a `sessionKey` on its own,
   * with no identity involved); leaving the draft would submit one person's
   * quiz answers under the next person's account. `src/lib/signout.ts` says why
   * those two travel together.
   *
   * Local state goes FIRST and unconditionally. If the network call fails there
   * is nothing to roll back, and the failure mode of clearing too eagerly
   * (re-join through `/join/<code>`, which recognises a signed-in member by
   * their account and hands back the same seat) is far milder than the failure
   * mode of not clearing at all.
   */
  async function signOut() {
    clearLocalState();
    await authClient.signOut();
    router.push("/");
  }

  if (user === undefined) {
    return (
      <ScreenPending />
    );
  }

  if (user === null) {
    return (
      <Screen>
        <h1 className="display text-[38px] text-text">Settings</h1>
        <p className="text-[15px] leading-snug text-dim">
          These are the settings for an account, and this browser is not signed in to one.
          Rooms you were let into as a guest need no account and are not listed here — they
          live at the link you were sent.
        </p>
        <Plate variant="action" center href="/sign-in?redirect=%2Fsettings" label="Sign in" />
      </Screen>
    );
  }

  return (
    <Screen>
      <h1 className="display text-[38px] text-text">Settings</h1>

      {/* Mounted empty and filled later: a live region inserted into the DOM
          with its text already inside it is frequently never announced.
          `empty:-mt-8` takes back the flex gap an empty paragraph would leave. */}
      <p role="alert" className="text-[13px] leading-snug text-danger empty:-mt-8">
        {error ?? ""}
      </p>

      <section aria-labelledby="who-heading" className="flex flex-col gap-3">
        <h2 id="who-heading" className="board text-[11px] text-accent">
          Signed in as
        </h2>
        <p className="text-[15px] leading-snug text-text">{user.email ?? user.name}</p>

        {/* The picture, at the size it is actually used, next to the controls
            that change it. Shown here rather than as a big preview because 44px
            IS the artwork -- a 200px crop that looks fine and a 44px roundel
            that turns to mush are the same file, and only one of them is what
            anybody will see. */}
        <div className="mt-2 flex items-center gap-4">
          <span
            className="board flex size-[44px] shrink-0 items-center justify-center overflow-hidden rounded-full border border-action-edge bg-action text-[11px] text-on-action"
            aria-hidden="true"
          >
            {profile?.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.avatarUrl} alt="" className="size-full object-cover" />
            ) : (
              initialsFor(profile?.displayName ?? user.name ?? user.email)
            )}
          </span>

          <div className="flex flex-wrap items-center gap-3">
            {/* A real file input, visually replaced by a Plate-shaped label
                rather than hidden behind a button that clicks it: a label IS
                the input's control, so it keeps the keyboard behaviour, the
                focus ring and the screen-reader announcement that a click
                forwarder throws away. `sr-only` rather than `display:none`,
                because a hidden input is not focusable. */}
            <label
              htmlFor="avatar"
              className="board flex min-h-[44px] cursor-pointer items-center rounded-[6px] bg-ground-raised px-4 text-[11px] text-text"
            >
              {uploading ? "Uploading…" : profile?.avatarUrl ? "Change picture" : "Add a picture"}
            </label>
            <input
              id="avatar"
              type="file"
              className="sr-only"
              accept={AVATAR_TYPES.join(",")}
              ref={fileInput}
              disabled={uploading}
              onChange={(e) => void uploadAvatar(e.target.files?.[0] ?? null)}
            />

            {profile?.avatarUrl ? (
              <button
                type="button"
                onClick={() => void removeAvatar()}
                disabled={uploading}
                className="flex min-h-[44px] min-w-[44px] items-center px-1 text-[13px] text-dim underline underline-offset-4"
              >
                Remove
              </button>
            ) : null}
          </div>
        </div>
        <p className="text-[12px] leading-snug text-dim">
          PNG, JPEG, WebP or GIF, under <span className="num">{MAX_AVATAR_MB}</span>MB. Without
          one your roundel shows your initials.
        </p>

        <label htmlFor="display-name" className="board mt-2 text-[11px] text-accent">
          Display name
        </label>
        <Input
          id="display-name"
          value={displayName}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
          maxLength={40}
          autoComplete="name"
        />
        <p className="text-[12px] leading-snug text-dim">
          What a room calls you when you open one. The name people see inside a room is
          the one typed at its door, so changing this does not rename you in a room you
          are already in.
        </p>
        <Plate
          variant="raised"
          center
          label={busy ? "Saving…" : saved ? "Saved" : "Save name"}
          disabled={busy || !displayName.trim() || displayName.trim() === profile?.displayName}
          onClick={() => void saveName()}
        />
      </section>

      <section aria-labelledby="answers-heading" className="flex flex-col gap-3">
        <h2 id="answers-heading" className="board text-[11px] text-accent">
          Your answers
        </h2>

        {profile === undefined ? (
          <p className="text-[13px] text-dim">Looking…</p>
        ) : profile === null ? (
          <p className="text-[13px] leading-snug text-dim">
            You have not answered the quiz yet. Until you do, rooms are ranked on budget,
            distance and mood alone.
          </p>
        ) : (
          <>
            {/* A profile written before the answers were stored has the derived
                taste sentence and nothing to show underneath it. Saying so is
                better than rendering seven blanks that read as "no opinion". */}
            {profile.answers === undefined ? (
              <p className="text-[13px] leading-snug text-dim">
                This profile predates the answers being kept, so there is nothing to show
                — but retaking the quiz will store them.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {QUIZ_CARDS.map((card) => {
                  const answer = profile.answers?.[card.id];
                  return (
                    <li
                      key={card.id}
                      className="flex items-baseline justify-between gap-3 border-b border-hairline pb-2"
                    >
                      <span className="text-[14px] leading-snug text-text">{card.text}</span>
                      <span className="board shrink-0 text-[11px] text-dim">
                        {answer === "more" ? "More" : answer === "less" ? "Less" : "—"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            <h3 className="board mt-2 text-[11px] text-accent">What the night is for</h3>
            <p className="text-[14px] leading-snug text-text">
              {profile.goals && profile.goals.length > 0
                ? QUIZ_GOALS.filter((g) => profile.goals?.includes(g.id))
                    .map((g) => g.text)
                    .join(" · ")
                : "Nothing in particular."}
            </p>
          </>
        )}

        <Plate
          variant="raised"
          center
          href="/start?retake=1"
          label="Retake the quiz"
          sub="Your current answers are the starting point, so you only change what has changed."
        />
      </section>

      <section aria-labelledby="rooms-heading" className="flex flex-col gap-3">
        <h2 id="rooms-heading" className="board text-[11px] text-accent">
          Your rooms
        </h2>

        {rooms === undefined ? (
          <p className="text-[13px] text-dim">Looking…</p>
        ) : rooms.length === 0 ? (
          <p className="text-[13px] leading-snug text-dim">
            No rooms yet. Ones you were let into as a guest, before signing in, are not
            listed here — those live at the link you were sent.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {rooms.map((room) => (
              <Plate
                key={room.code}
                variant="raised"
                href={`/room/${room.code}`}
                label={`${MOOD_LABEL[room.mood] ?? room.mood}${room.isHost ? " · yours" : ""}`}
                sub={`${STATUS_LABEL[room.status] ?? room.status} · ${roomWhen(room.whenAt)}${
                  room.demo ? " · demonstration room" : ""
                }`}
                right={room.code}
              />
            ))}
          </div>
        )}
        <p className="text-[12px] leading-snug text-dim">
          A room opens on the device that holds its seat. On a new device, join again with
          the room number — you will be given the same seat back, not a second one.
        </p>
      </section>

      {/* `id` as well as the heading's own: the account menu's "Delete
          account" navigates to /settings#leaving rather than deleting from a
          dropdown, and this is what it lands on. */}
      <section id="leaving" aria-labelledby="leaving-heading" className="flex flex-col gap-4">
        <h2 id="leaving-heading" className="board text-[11px] text-accent">
          Leaving
        </h2>

        <ConfirmButton
          label="Sign out"
          confirmLabel="Yes, sign out"
          cancelLabel="Stay signed in"
          onConfirm={async () => {
            await signOut();
            return "gone";
          }}
        />
        <p className="text-[12px] leading-snug text-dim">
          Signing out also drops the seats this browser is holding. You can take them back
          by joining with the room number again.
        </p>

        <ConfirmButton
          label="Delete my account"
          confirmLabel="Yes, delete it"
          cancelLabel="Keep my account"
          onConfirm={async () => {
            setError(null);
            try {
              await deleteAccount({});
            } catch (e) {
              setError(
                userMessage(e, "Could not delete the account. Please try again."),
              );
              return "trigger";
            }
            clearLocalState();
            await authClient.signOut();
            router.push("/");
            return "gone";
          }}
        />
        <p className="text-[12px] leading-snug text-dim">
          Your seat in every room goes immediately, along with the swipes and votes you
          cast there, and that part cannot be undone. Everything else is kept for{" "}
          <span className="num">{PURGE_WINDOW_DAYS}</span> days — sign back in within that
          time and the account comes back as it was. After that it is erased. You cannot
          delete while you are still hosting a night that has not been booked and has not
          yet passed; the room would have no one who could start it.
        </p>
      </section>

      <Link
        href="/start"
        className="board flex min-h-[44px] min-w-[44px] w-fit items-center px-1 text-[11px] text-accent underline underline-offset-4"
      >
        Back to Questly
      </Link>
    </Screen>
  );
}
