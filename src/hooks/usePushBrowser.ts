"use client";

import { useEffect, useState } from "react";
import { PUSH_ASK_DISMISSED_KEY, type PushPermission } from "@/lib/pwa/push";
import { isIosSafari, isStandalone } from "@/lib/pwa/install";

/**
 * What THIS browser has to say about notifications: can it, may it, does it
 * already, and is it the platform that needs installing first.
 *
 * Separated from `usePush` because it is the half with no server in it. Every
 * value here comes from `Notification`, `navigator`, `matchMedia`,
 * `localStorage` or the service worker registration, none of which exist while
 * the page renders on the server -- so this is also the half that must start as
 * "nothing read yet" and fill in from an effect. Keeping that in one small hook
 * means the composition above it reads as a set of facts rather than as a
 * mount-time DOM negotiation.
 */

export type PushBrowserState = {
  /** `Notification`, `PushManager` and a service worker are all present. */
  supported: boolean;
  permission: PushPermission;
  /** Does this browser already hold a push subscription for this origin? */
  subscribed: boolean;
  iosSafari: boolean;
  standalone: boolean;
  /** They said "not now" to the soft ask before. */
  dismissed: boolean;
};

/** Before the mount effect has run. Also the whole of the server render. */
const UNREAD: PushBrowserState = {
  supported: false,
  permission: "default",
  subscribed: false,
  iosSafari: false,
  standalone: false,
  dismissed: false,
};

/**
 * The service worker registration, once it is genuinely usable.
 *
 * `navigator.serviceWorker.ready` and not `register()`: `ServiceWorker.tsx`
 * already registers `/sw.js` on every page, and calling `register` a second
 * time here would race it. `ready` resolves with the ACTIVE registration, which
 * is the only thing `pushManager.subscribe` will accept -- an installing worker
 * has no push manager to subscribe with.
 */
export async function activeWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  return await navigator.serviceWorker.ready;
}

function read(): PushBrowserState {
  const supported =
    typeof window !== "undefined" &&
    "Notification" in window &&
    "PushManager" in window &&
    "serviceWorker" in navigator;

  let dismissed = false;
  try {
    dismissed = localStorage.getItem(PUSH_ASK_DISMISSED_KEY) !== null;
  } catch {
    // Safari's "Block All Cookies". Not being able to remember a "not now"
    // only means the ask comes back next visit, which is the safe direction.
  }

  return {
    supported,
    permission: supported ? (Notification.permission as PushPermission) : "default",
    subscribed: false,
    iosSafari: isIosSafari(navigator.userAgent, navigator.maxTouchPoints),
    standalone: isStandalone(
      matchMedia("(display-mode: standalone)").matches,
      // Non-standard, iOS only, and typed as absent everywhere else.
      (navigator as Navigator & { standalone?: boolean }).standalone,
    ),
    dismissed,
  };
}

export function usePushBrowser() {
  const [state, setState] = useState<PushBrowserState>(UNREAD);

  // A mount-time read of `Notification.permission`, `navigator` and
  // `localStorage`, none of which exist while this renders on the server. The
  // same named exception `useSessionKey` carries, for the same reason: the read
  // cannot happen during render, and an effect that reads a browser store has
  // nowhere to put the result but state.
  useEffect(() => {
    let live = true;
    const base = read();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(base);
    if (!base.supported) return;

    // The subscription lookup is asynchronous and lands second, so the two
    // writes are separate rather than one awaited read -- the permission and
    // the platform are useful immediately and the worker may take a moment.
    void (async () => {
      const registration = await activeWorker();
      const existing = await registration?.pushManager.getSubscription();
      if (live) setState({ ...base, subscribed: existing != null });
    })();

    return () => {
      live = false;
    };
  }, []);

  return { ...state, setState };
}
