"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { userMessage } from "@/lib/errors";
import {
  PUSH_ASK_DISMISSED_KEY,
  permissionMessage,
  shouldAskForPush,
  urlBase64ToUint8Array,
  type PushPermission,
} from "@/lib/push";
import { isIosSafari, isStandalone } from "@/lib/pwa";

/**
 * Everything the browser half of push notifications needs, in one hook.
 *
 * Two screens ask the same questions -- the soft ask on `/start` and in a room,
 * and the toggle in settings -- and every one of those questions is a
 * multi-step conversation with the service worker registration, the permission
 * API and the push manager. Two copies of that would be two copies of the
 * subscribe sequence, which has an order that matters and a failure mode that
 * is silence.
 *
 * WHO THIS WORKS FOR. Both kinds of person, because the product has both. A
 * signed-in caller passes no seat and is identified by their account. A guest
 * passes the room code and `sessionKey` they already hold, and their
 * subscription is filed against that seat. The hook does not decide which --
 * it passes what it is given and the server resolves it, which is the only
 * place that decision can be trusted.
 */

type Seat = { code: string; sessionKey: string } | null;

/** The browser facts the pure predicates in `@/lib/push` need. */
type BrowserState = {
  supported: boolean;
  permission: PushPermission;
  /** Does THIS browser already hold a push subscription for this origin? */
  subscribed: boolean;
  iosSafari: boolean;
  standalone: boolean;
  dismissed: boolean;
};

const UNREAD: BrowserState = {
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
async function activeWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  return await navigator.serviceWorker.ready;
}

function readBrowserState(): BrowserState {
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

export function usePush(seat: Seat = null) {
  // `undefined` while the server has not answered. Null is a real answer and
  // means the deployment has no VAPID keys, so push does not exist here -- a
  // state every screen draws as absence rather than as a failure.
  const publicKey = useQuery(api.push.publicKey, {});
  // Pulled apart into two strings and memoised on those, not on the object.
  // Callers build the seat inline -- `<PushHint seat={{ code, sessionKey }} />`
  // -- so the object is fresh on every render. Passed straight through it would
  // give `useQuery` a new argument each render, and a new subscription with it,
  // and would invalidate every callback below.
  const seatCode = seat?.code;
  const seatKey = seat?.sessionKey;
  const seatArgs = useMemo(
    () => (seatCode && seatKey ? { code: seatCode, sessionKey: seatKey } : {}),
    [seatCode, seatKey],
  );
  // Null is a real answer from the server and means "nobody to file a
  // subscription under"; a number means the caller was identified. Undefined is
  // only "the query has not come back yet".
  const deviceCount = useQuery(api.push.myDeviceCount, seatArgs);
  const identified = typeof deviceCount === "number";

  const subscribe = useMutation(api.push.subscribe);
  const unsubscribe = useMutation(api.push.unsubscribe);
  const sendTest = useMutation(api.push.sendTest);

  const [browser, setBrowser] = useState<BrowserState>(UNREAD);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  // A mount-time read of `Notification.permission`, `navigator` and
  // `localStorage`, none of which exist while this renders on the server. The
  // same named exception `useSessionKey` carries, for the same reason: the read
  // cannot happen during render, and an effect that reads a browser store has
  // nowhere to put the result but state.
  useEffect(() => {
    let live = true;
    const base = readBrowserState();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBrowser(base);
    if (!base.supported) return;

    void (async () => {
      const registration = await activeWorker();
      const existing = await registration?.pushManager.getSubscription();
      if (live) setBrowser({ ...base, subscribed: existing !== null && existing !== undefined });
    })();

    return () => {
      live = false;
    };
  }, []);

  /**
   * Turn it on, from inside the tap that asked.
   *
   * THE ORDER IS THE WHOLE THING, and it is not rearrangeable:
   *
   * 1. `requestPermission()` FIRST, and synchronously enough within the tap
   *    that Safari still counts it as user-activated. Safari rejects the call
   *    outright otherwise, and Chrome's quiet UI silently swallows it.
   * 2. `pushManager.subscribe` only after permission is granted. Subscribing
   *    without it throws on every browser.
   * 3. The server row LAST. A row written before the browser confirmed is a
   *    row we would send to and nothing would receive, and the endpoint is not
   *    even known until step 2 resolves.
   */
  const enable = useCallback(async (): Promise<boolean> => {
    if (!publicKey) return false;
    setBusy(true);
    setError(null);
    try {
      const permission = (await Notification.requestPermission()) as PushPermission;
      setBrowser((previous) => ({ ...previous, permission }));
      if (permission !== "granted") {
        setError(permissionMessage(permission));
        return false;
      }

      const registration = await activeWorker();
      if (!registration) {
        setError("This browser cannot run the background worker notifications need.");
        return false;
      }

      // Reuse before re-subscribe. A browser that already holds a subscription
      // for this origin hands back the same one, and asking for a second is how
      // an endpoint ends up rotated for no reason -- which silently orphans the
      // row the server is already sending to.
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          // Not optional in practice: Chrome refuses a subscription that is
          // allowed to deliver silently, and iOS REVOKES one that receives a
          // push it does not show. `sw.js` shows a notification every time for
          // the same reason.
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }));

      const json = subscription.toJSON();
      if (!json.keys?.p256dh || !json.keys.auth) {
        setError("This browser did not give us the keys a notification is encrypted with.");
        return false;
      }

      const accepted = await subscribe({
        endpoint: subscription.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
        ...seatArgs,
      });
      if (!accepted) {
        setError("Sign in, or open this from your room, and we will know who to notify.");
        return false;
      }

      setBrowser((previous) => ({ ...previous, subscribed: true }));
      return true;
    } catch (raw) {
      setError(userMessage(raw, "Notifications could not be turned on."));
      return false;
    } finally {
      setBusy(false);
    }
  }, [publicKey, subscribe, seatArgs]);

  /**
   * Turn it off.
   *
   * Both halves, and the server one FIRST. If the browser's `unsubscribe()`
   * succeeded and the server call then failed, the row would survive with an
   * endpoint nothing can receive on -- invisible, and only cleaned up the next
   * time a push service returns a 410 for it.
   */
  const disable = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const registration = await activeWorker();
      const existing = await registration?.pushManager.getSubscription();
      if (existing) {
        await unsubscribe({ endpoint: existing.endpoint, ...seatArgs });
        await existing.unsubscribe();
      }
      setBrowser((previous) => ({ ...previous, subscribed: false }));
    } catch (raw) {
      setError(userMessage(raw, "Notifications could not be turned off."));
    } finally {
      setBusy(false);
    }
  }, [unsubscribe, seatArgs]);

  /** Prove it works. The server picks the recipient; nothing here names one. */
  const test = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setSent(false);
    try {
      const accepted = await sendTest(seatArgs);
      if (!accepted) {
        setError("Sign in, or open this from your room, and we will know who to notify.");
        return;
      }
      setSent(true);
    } catch (raw) {
      setError(userMessage(raw, "The test notification could not be sent."));
    } finally {
      setBusy(false);
    }
  }, [sendTest, seatArgs]);

  /** Remember a "not now", so the soft ask does not become nagging. */
  const dismiss = useCallback(() => {
    setBrowser((previous) => ({ ...previous, dismissed: true }));
    try {
      localStorage.setItem(PUSH_ASK_DISMISSED_KEY, "1");
    } catch {
      // Closed for this visit either way; it just comes back next time.
    }
  }, []);

  return {
    /** Null means the deployment has no keys; undefined means still loading. */
    publicKey,
    /** How many devices this owner is listening on, server-side. */
    deviceCount: deviceCount ?? 0,
    /** Did the server manage to place this caller at all? */
    identified,
    /** Is THIS browser subscribed? What the toggle draws. */
    subscribed: browser.subscribed,
    permission: browser.permission,
    supported: browser.supported,
    /** Is there any point showing a control at all on this device? */
    available:
      browser.supported &&
      publicKey != null &&
      identified &&
      (!browser.iosSafari || browser.standalone),
    iosNeedsInstall: browser.iosSafari && !browser.standalone,
    ask: shouldAskForPush({
      supported: browser.supported,
      configured: publicKey != null,
      // The server is the authority here and has already answered: it returns
      // null for a caller it cannot place, and a number for one it can. The
      // client never guesses at this.
      identified,
      subscribed: browser.subscribed,
      permission: browser.permission,
      dismissed: browser.dismissed,
      iosSafari: browser.iosSafari,
      standalone: browser.standalone,
    }),
    busy,
    error,
    sent,
    enable,
    disable,
    test,
    dismiss,
  };
}
