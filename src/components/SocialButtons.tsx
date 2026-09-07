"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { authClient } from "@/lib/auth-client";
import { Button } from "./ui";

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
          onClick={() =>
            authClient.signIn.social({ provider, callbackURL: redirectTo })
          }
        >
          Continue with {LABELS[provider] ?? provider}
        </Button>
      ))}
    </div>
  );
}
