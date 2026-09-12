"use client";

import { useStandaloneRedirect } from "@/hooks/useStandaloneRedirect";

/**
 * The client edge of `useStandaloneRedirect`, and nothing else.
 *
 * `page.tsx` stays a server component so the signed-in read still happens on
 * the server with no signed-out flash; this is the one island in it. Rendering
 * nothing is the point -- the redirect is the whole behaviour, and on the web
 * it does not fire at all.
 */
export function StandaloneRedirect() {
  useStandaloneRedirect();
  return null;
}
