"use client";

import type { ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { authClient } from "@/lib/account/auth-client";
import { Button } from "./ui";

/**
 * Brand marks, and the one place this codebase draws in colour.
 *
 * They are here rather than in `questly/icons.tsx` on purpose: that file is one
 * drawn set -- 24-box, 2px stroke, `currentColor` -- and a logo is not a member
 * of it. A logo is somebody else's artwork, redrawn is wrong, and recoloured to
 * the theme is wrong too, which is exactly why these two do not belong in a set
 * whose whole rule is that everything in it inherits the text colour.
 *
 * Both marks sit on a transparent button in either theme, so both are given
 * their own fills rather than the page's: Discord blurple and the four-colour
 * G are legible on the light ground and the dark one alike.
 */
const MARK: Record<string, ReactNode> = {
  google: (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.05l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
      />
    </svg>
  ),
  discord: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="#5865F2" aria-hidden>
      <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.011c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .079.01c.12.099.246.198.373.292a.077.077 0 0 1-.006.128c-.598.349-1.22.65-1.873.891a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.029 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.055c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.029ZM8.02 15.331c-1.182 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.211 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z" />
    </svg>
  ),
};

const LABELS: Record<string, string> = { google: "Google", discord: "Discord" };

/**
 * Only renders providers that actually have credentials set in the Convex env,
 * so there are never buttons that lead to a broken OAuth screen.
 *
 * When there are none, this renders NOTHING. It used to tell the visitor
 * "Social sign-in is inactive: no OAuth credentials set in the Convex
 * environment yet" -- a deployment note, on a customer's sign-in page, about a
 * system they have never heard of and cannot do anything about. A sign-in form
 * that simply does not offer Google is not a state anybody needs explaining.
 */
export function SocialButtons({ redirectTo }: { redirectTo: string }) {
  const providers = useQuery(api.auth.enabledSocialProviders);

  if (providers === undefined || providers.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {providers.map((provider) => (
        <Button
          key={provider}
          type="button"
          variant="secondary"
          className="gap-2"
          onClick={() =>
            authClient.signIn.social({ provider, callbackURL: redirectTo })
          }
        >
          {/* Decorative: the button already says which provider it is, so the
              mark is `aria-hidden` and adds nothing to the accessible name. */}
          {MARK[provider]}
          Continue with {LABELS[provider] ?? provider}
        </Button>
      ))}
    </div>
  );
}
