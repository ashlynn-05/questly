"use client";

import { useEffect } from "react";

/**
 * Registers `public/sw.js`. Renders nothing.
 *
 * Production only, and not out of caution: `next dev` serves every module
 * fresh, so a worker that intercepts navigations sits between the dev server
 * and the page for no benefit, and one that has already claimed the origin
 * outlives the `next dev` that installed it -- it stays registered against
 * localhost and starts answering the NEXT project served from the same port.
 * To exercise it, run `npm run build && npm start`.
 *
 * `updateViaCache: "none"` so the browser always revalidates the worker script
 * itself rather than serving it from the HTTP cache; `next.config.ts` sends the
 * matching no-store header for the same reason. Between them, a bad worker
 * cannot pin itself in place.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    // Nothing downstream waits on this. A failed registration costs the
    // offline fallback and, on Chrome, the install prompt -- it must never
    // cost the page, so the rejection is swallowed rather than thrown into an
    // effect that has no way to recover.
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
  }, []);

  return null;
}
