"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { MAX_AVATAR_MB, refuseAvatar } from "@convex/lib/account/avatar";
import { authClient } from "@/lib/account/auth-client";
import { clearLocalState } from "@/lib/account/signout";
import { userMessage } from "@/lib/errors";
import { Plate } from "@/components/questly/Plate";
import { ConfirmButton } from "@/components/questly/ConfirmButton";
import { Screen, ScreenPending } from "@/components/questly/Screen";
import { ShellNav } from "@/components/questly/ShellNav";
import { Hint } from "@/components/questly/Hint";
import { Back } from "@/components/questly/icons";
import { useRedirectIfDeleting } from "@/hooks/useRedirectIfDeleting";
import { Section } from "./_components/Section";
import { SettingsAnswersSection } from "./_components/SettingsAnswersSection";
import { SettingsProfileSection } from "./_components/SettingsProfileSection";
import { SettingsPushSection } from "./_components/SettingsPushSection";
import { SettingsRoomsSection } from "./_components/SettingsRoomsSection";

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

  useRedirectIfDeleting(deletion);

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
    return <ScreenPending />;
  }

  if (user === null) {
    return (
      <Screen nav={<ShellNav route="settings" />}>
        <h1 className="display text-[38px] text-text">Settings</h1>
        <p className="text-[15px] leading-snug text-dim">
          These are the settings for an account, and this browser is not signed in to one.
          A room you were let into as a guest needs no account and is not listed here — it
          lives at the link you were sent.
        </p>
        <Plate variant="action" center href="/sign-in?redirect=%2Fsettings" label="Sign in" />
      </Screen>
    );
  }

  return (
    <Screen nav={<ShellNav route="settings" />}>
      <div className="flex w-full flex-col gap-8">
        {/* The way back, at the top where a back control belongs, drawn rather
            than written. It used to be the words "Back to Questly" at the very
            bottom of the page -- past six sections, reachable only by scrolling
            the whole screen you were trying to leave. As a roundel it joins the
            two already in the band above it: same circle, same 44px target, and
            the arrow says "back along the line" in the product's own vocabulary
            instead of spending a line of type on it.

            `items-center` and not `baseline`: the roundel is a shape, and
            aligning a circle to the baseline of a 38px display face hangs it low
            against the cap height. */}
        <div className="flex items-center gap-3">
          <Link
            href="/start"
            aria-label="Back to Questly"
            className="flex size-[44px] shrink-0 items-center justify-center rounded-full border border-dim text-accent"
          >
            <Back className="size-[20px]" />
          </Link>
          <h1 className="display text-[38px] text-text">Settings</h1>
        </div>

        {/* Mounted empty and filled later: a live region inserted into the DOM
            with its text already inside it is frequently never announced.
            `empty:-mt-8` takes back the flex gap an empty paragraph would leave. */}
        <p role="alert" className="text-[13px] leading-snug text-danger empty:-mt-8">
          {error ?? ""}
        </p>

        {/* Two columns from `lg`. One column of sections was right when the
          shell was a phone-width sheet and stayed right at 1024px, where 520px
          of measure and a 236px nav account for most of the window. It stops
          being right above that: at 1440px it left 420px of the body empty and
          at 1856px it left 836px, so the page read as a phone screen someone
          had parked on the left of a monitor.

          The 520px ruling it replaces was about DISTANCE, not about one column:
          every section here is a label and one control, and a switch three feet
          to the right of the sentence naming it is a switch nobody is sure they
          read correctly. Two columns of 446px keep every control closer to its
          own label than 520px ever did.

          The split is by what you are there to do. Left is who you are: the
          account, the picture, the name, and the answers that score every venue
          you will ever be shown. Right is what this browser holds -- what it
          notifies, what rooms it can see, and how to end both -- which is the
          division the nav beside it already labels in so many words.

          The two halves do not come out the same height, and balancing them is
          not worth what it costs: the only section long enough to even the
          columns is Leaving, and moving it changes the order on a PHONE, where
          it would put "Delete my account" above the room list. The rule here is
          that the phone owns its own layout, so DOM order is the phone's order
          and the laptop takes the ragged bottom edge.

          `contents` below `lg`, so both levels of wrapper are inert there and
          the five sections stay direct children of one flex column. */}
        <div className="contents lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-12">
          <div className="contents lg:flex lg:flex-col lg:gap-8">
            <SettingsProfileSection
              user={user}
              profile={profile}
              displayName={displayName}
              busy={busy}
              saved={saved}
              uploading={uploading}
              fileInput={fileInput}
              setName={setName}
              setSaved={setSaved}
              saveName={saveName}
              uploadAvatar={uploadAvatar}
              removeAvatar={removeAvatar}
            />

            <SettingsAnswersSection profile={profile} />

          </div>

          <div className="contents lg:flex lg:flex-col lg:gap-8">
            <SettingsPushSection />

            <SettingsRoomsSection rooms={rooms} />

            {/* `id` as well as the heading's own: the account menu's "Delete
                account" navigates to /settings#leaving rather than deleting from a
                dropdown, and this is what it lands on. */}
            <Section id="leaving" title="Leaving">
              {/* Each row is control-then-question-mark, so the two things that end a
                  session sit on the same line as the sentence explaining what they
                  cost. They used to be a button followed by a paragraph, which put
                  the warning BELOW the control it was warning about. */}
              {/* `-ml-3` cancels ConfirmButton's own left padding, which is target
                  area rather than indent: without it these two labels start three
                  pixels in from the column every other row in this screen is flush
                  with. The negative margin is on the row so it holds in the armed
                  state too, where the trigger is replaced by two buttons. */}
              <div className="-ml-3 flex items-center justify-between gap-3">
                <ConfirmButton
                  label="Sign out"
                  confirmLabel="Yes, sign out"
                  cancelLabel="Stay signed in"
                  onConfirm={async () => {
                    await signOut();
                    return "gone";
                  }}
                />
                <Hint topic="signout" />
              </div>

              {/* `-ml-3` cancels ConfirmButton's own left padding, which is target
                  area rather than indent: without it these two labels start three
                  pixels in from the column every other row in this screen is flush
                  with. The negative margin is on the row so it holds in the armed
                  state too, where the trigger is replaced by two buttons. */}
              <div className="-ml-3 flex items-center justify-between gap-3">
                <ConfirmButton
                  label="Delete my account"
                  confirmLabel="Yes, delete it"
                  cancelLabel="Keep my account"
                  onConfirm={async () => {
                    setError(null);
                    try {
                      await deleteAccount({});
                    } catch (e) {
                      setError(userMessage(e, "Could not delete the account. Please try again."));
                      return "trigger";
                    }
                    clearLocalState();
                    await authClient.signOut();
                    router.push("/");
                    return "gone";
                  }}
                />
                <Hint topic="deletion" />
              </div>
            </Section>
          </div>
        </div>
      </div>
    </Screen>
  );
}
