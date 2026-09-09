"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * An account on its way out belongs on `/restore`, and nowhere else.
 *
 * `/restore` is the one screen written for that state, and keeping the deadline,
 * the wording and the button there means no other screen has to grow a second
 * copy of the offer. Two screens can be reached while a deletion is pending --
 * settings, and the top of the funnel -- so both ask this.
 *
 * The funnel needs it for a second reason. `profiles.me` returns null for a
 * tombstoned profile, deliberately, so no other screen has to know that state
 * exists -- and the funnel reads exactly that null as "has not answered the
 * quiz". Without this, somebody who deleted their account and signed back in
 * would be walked through onboarding again with their own answers sitting one
 * query away.
 *
 * `undefined` is the query still loading and must not redirect anybody.
 */
export function useRedirectIfDeleting(deletion: unknown): void {
  const router = useRouter();
  useEffect(() => {
    if (deletion) router.replace("/restore");
  }, [deletion, router]);
}
