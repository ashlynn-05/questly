"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isStandalone } from "@/lib/pwa/install";

/**
 * Inside the installed app, `/` is not a front door.
 *
 * `manifest.ts` already launches the installed app at `/start` rather than
 * here, and the comment there says why: somebody who put Questly on their home
 * screen has already been sold, and landing them on the pitch is a tax on the
 * people who liked it most. But `scope` is `/`, and the wordmark in `Screen`'s
 * band links to `/` on every route -- so the standalone window can still reach
 * this page from the inside. That is the gap this closes. On the web nothing
 * happens and the landing page renders normally.
 *
 * `/start` restores its own draft from `sessionStorage` (see
 * `src/lib/start/funnel.ts`), so a re-entry lands where the last one stopped
 * rather than at the top of the funnel.
 *
 * WHY AN EFFECT, given that the Next 16 docs in `node_modules/next/dist/docs/`
 * do not endorse redirect-on-mount and steer this kind of thing to an event
 * handler or a server `redirect()`: neither of those can see
 * `display-mode: standalone`. It is a fact about the window the browser opened,
 * known only to the client, and there is no event to hang it off -- the
 * condition is already true when the page mounts. So this is the one available
 * mechanism, not the convenient one.
 */
export function useStandaloneRedirect(): void {
  const router = useRouter();

  useEffect(() => {
    const standalone = isStandalone(
      matchMedia("(display-mode: standalone)").matches,
      // Non-standard, iOS only, and typed as absent everywhere else.
      (navigator as Navigator & { standalone?: boolean }).standalone,
    );
    if (standalone) router.replace("/start");
  }, [router]);
}
