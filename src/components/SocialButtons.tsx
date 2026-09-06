"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { authClient } from "@/lib/auth-client";
import { Button } from "./ui";

const LABELS: Record<string, string> = { google: "Google", discord: "Discord" };

/**
 * Only renders providers that actually have credentials set in the Convex env,
 * so there are never buttons that lead to a broken OAuth screen.
 */
export function SocialButtons({ redirectTo }: { redirectTo: string }) {
  const providers = useQuery(api.auth.enabledSocialProviders);

  if (providers === undefined) return null;
  if (providers.length === 0) {
    return (
      <p className="text-xs text-neutral-500">
        Social sign-in is inactive: no OAuth credentials set in the Convex environment yet.
      </p>
    );
  }

  return (
    <div className="flex gap-2">
      {providers.map((provider) => (
        <Button
          key={provider}
          type="button"
          variant="secondary"
          className="flex-1"
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
