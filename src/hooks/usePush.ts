"use client";

import { useCallback, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { userMessage } from "@/lib/errors";
import {
  PUSH_ASK_DISMISSED_KEY,
  permissionMessage,
  shouldAskForPush,
  urlBase64ToUint8Array,
  type PushPermission,
} from "@/lib/pwa/push";
import { activeWorker, usePushBrowser } from "./usePushBrowser";
import { usePushSeat, type Seat } from "./usePushSeat";

/**
 * Everything the browser half of push notifications needs, composed.
 *
 * Two screens ask the same questions -- the soft ask on `/start` and in a room,
 * and the toggle in settings -- and every one of those questions is a
 * multi-step conversation with the service worker registration, the permission
 * API and the push manager. Two copies of that would be two copies of the
 * subscribe sequence, which has an order that matters and a failure mode that
 * is silence.
 *
 * THREE HOOKS, NOT ONE. `usePushBrowser` holds what this device says, with no
 * server in it. `usePushSeat` holds what the server says about who is asking,
 * with no DOM in it. This file is the part that needs both: the turn-on
 * sequence, which is a browser negotiation whose last step is a server write,
 * and the decision about whether to ask at all, which is a rule over facts from
 * both sides. Each half is separately readable, and the two halves are
 * separately reusable -- a screen that only wants the device count does not
 * have to mount a service worker lookup.
 */
export function usePush(seat: Seat = null) {
  // `undefined` while the server has not answered. Null is a real answer and
  // means the deployment has no VAPID keys, so push does not exist here -- a
  // state every screen draws as absence rather than as a failure.
  const publicKey = useQuery(api.push.publicKey, {});
  const { args, deviceCount, identified } = usePushSeat(seat);
  const browser = usePushBrowser();

  const subscribe = useMutation(api.push.subscribe);
  const unsubscribe = useMutation(api.push.unsubscribe);
  const sendTest = useMutation(api.push.sendTest);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const { setState } = browser;

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
      setState((previous) => ({ ...previous, permission }));
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
        ...args,
      });
      if (!accepted) {
        setError("Sign in, or open this from your room, and we will know who to notify.");
        return false;
      }

      setState((previous) => ({ ...previous, subscribed: true }));
      return true;
    } catch (raw) {
      setError(userMessage(raw, "Notifications could not be turned on."));
      return false;
    } finally {
      setBusy(false);
    }
  }, [publicKey, subscribe, args, setState]);

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
        await unsubscribe({ endpoint: existing.endpoint, ...args });
        await existing.unsubscribe();
      }
      setState((previous) => ({ ...previous, subscribed: false }));
    } catch (raw) {
      setError(userMessage(raw, "Notifications could not be turned off."));
    } finally {
      setBusy(false);
    }
  }, [unsubscribe, args, setState]);

  /** Prove it works. The server picks the recipient; nothing here names one. */
  const test = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setSent(false);
    try {
      const accepted = await sendTest(args);
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
  }, [sendTest, args]);

  /** Remember a "not now", so the soft ask does not become nagging. */
  const dismiss = useCallback(() => {
    setState((previous) => ({ ...previous, dismissed: true }));
    try {
      localStorage.setItem(PUSH_ASK_DISMISSED_KEY, "1");
    } catch {
      // Closed for this visit either way; it just comes back next time.
    }
  }, [setState]);

  return {
    /** Null means the deployment has no keys; undefined means still loading. */
    publicKey,
    /** How many devices this owner is listening on, server-side. */
    deviceCount,
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
