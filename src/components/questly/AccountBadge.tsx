"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { authClient } from "@/lib/auth-client";
import { badgeLabel, initialsFor } from "@/lib/avatar";
import { clearLocalState } from "@/lib/signout";
import { Exit, PersonOut, Sliders } from "./icons";
import { MenuRoundel } from "./MenuRoundel";

/**
 * Who this browser is signed in as, and everything you can do about it.
 *
 * Replaces the "Settings" text link that used to sit in these headers. A link
 * said the same thing to everybody and told a signed-in person nothing about
 * WHICH account they were signed in as -- the question that actually matters on
 * a shared laptop, and the one this product had no answer to anywhere.
 *
 * Read through `api.profiles.me` and `api.auth.getCurrentUser`, never
 * `authClient.useSession()`: `src/app/ConvexClientProvider.tsx` documents that
 * upstream collapses `useSession().data` to `never`, and this branch already
 * carries one assertion for it.
 */
export function AccountBadge() {
  const router = useRouter();
  const user = useQuery(api.auth.getCurrentUser, {});
  const profile = useQuery(api.profiles.me, {});

  // Undefined is "still asking". A roundel drawn before the answer arrives
  // would flash the signed-out state at somebody who is signed in, on every
  // page load -- so the space is held at the same size and left empty.
  if (user === undefined) {
    return <div className="size-[44px] shrink-0" aria-hidden="true" />;
  }

  // No account: the honest control is a way to get one, not a badge with
  // nothing behind it. Deliberately still shown to a guest -- a guest who
  // tapped a group-chat link has no account, and the header says so rather
  // than pretending the door is not there.
  if (user === null) {
    return (
      <Link
        href="/sign-in"
        className="board flex min-h-[44px] min-w-[44px] items-center px-1 text-[11px] text-accent underline underline-offset-4"
      >
        Sign in
      </Link>
    );
  }

  // `profiles.me` is the renamed, product-owned name and wins; the Better Auth
  // record is what a brand-new account has before it finishes the quiz.
  const name = profile?.displayName ?? user.name ?? user.email ?? null;
  const avatarUrl = profile?.avatarUrl ?? null;

  async function signOut() {
    // Local state first and unconditionally: if the network call fails there
    // is nothing to roll back, and a browser holding nothing is a milder
    // failure than a browser holding everything. `src/lib/signout.ts` says
    // which stores and why.
    clearLocalState();
    await authClient.signOut();
    router.push("/");
  }

  return (
    <MenuRoundel
      filled
      label={badgeLabel(name)}
      items={[
        { label: "Settings", href: "/settings", icon: <Sliders /> },
        { label: "Sign out", onSelect: () => void signOut(), icon: <Exit /> },
        {
          label: "Delete account",
          destructive: true,
          icon: <PersonOut />,
          // Navigates to the confirm; does NOT delete. An account-ending
          // action one tap deep in a menu is a trap -- there is no undo for
          // the seats it gives up, and a menu is exactly where a mis-tap
          // happens. `/settings` keeps the two-step `ConfirmButton` and the
          // sentence explaining what does not come back.
          href: "/settings#leaving",
        },
      ]}
    >
      {avatarUrl ? (
        /* Convex storage serves these from the deployment's own origin with a
           signed URL that changes per read, so `next/image` has nothing stable
           to key a cache on and its optimiser would re-fetch every render. The
           file is capped at 2MB and drawn at 44px; there is no LCP to protect
           here. `alt=""` because the button's own label names the account --
           an alt would be the second announcement of the same thing. */
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt="" className="size-full object-cover" />
      ) : (
        // `aria-hidden` because these initials are an abbreviation: a screen
        // reader announcing "bee see" says nothing useful, and the button's
        // own label already names the account.
        <span aria-hidden="true">{initialsFor(name)}</span>
      )}
    </MenuRoundel>
  );
}
