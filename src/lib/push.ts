/**
 * The rules about asking for notification permission, as functions of their
 * inputs rather than of the browser.
 *
 * Pure for the same reason `pwa.ts` is: the suite runs on `edge-runtime` (see
 * `vitest.config.ts`), which has no `Notification`, no `PushManager` and no
 * `navigator`. The DOM reads live in `PushHint.tsx` and are a handful of lines;
 * every rule about what those lines MEAN lives here, next to its test.
 */

/** Where the "not now" is remembered, in the `questly-<thing>` house style. */
export const PUSH_ASK_DISMISSED_KEY = "questly-push-ask-dismissed";

/** What the browser will tell us about permission, in the three states it has. */
export type PushPermission = "default" | "granted" | "denied";

/**
 * What the mount effect has read off the browser, gathered in one place.
 *
 * An object rather than six positional booleans: every one of these is a
 * boolean, and six of them in a row is a call site nobody can read and a test
 * nobody can trust.
 */
export type PushAskState = {
  /** `Notification` and `PushManager` both exist, and a worker can register. */
  supported: boolean;
  /** The server has VAPID keys. Without them there is nothing to subscribe to. */
  configured: boolean;
  /** Signed in, or holding a seat in a room. Someone to file the row under. */
  identified: boolean;
  /** Already subscribed on this browser. */
  subscribed: boolean;
  permission: PushPermission;
  /** They said "not now" before. */
  dismissed: boolean;
  /** iOS, where push exists only once the app is on the home screen. */
  iosSafari: boolean;
  standalone: boolean;
};

/**
 * Should we put the soft ask in front of this person right now?
 *
 * WHY A SOFT ASK AT ALL, rather than calling `requestPermission()` on mount.
 * Two hard browser rules and one product one.
 *
 * Safari requires user activation: `requestPermission()` outside a tap is
 * rejected outright. Chrome's quiet permission UI suppresses a prompt that
 * arrives before the user has done anything, so the ask is spent for nothing.
 * And a dismissed native dialog is a PERMANENT denial that only the user can
 * undo, buried in browser settings -- so the one chance to ask is worth
 * spending on someone who has already said they want it. This dialog's "Not
 * now" costs nothing and can be offered again; the native one's cannot.
 *
 * `permission !== "default"` covers both ends: `granted` means there is nothing
 * to ask for, and `denied` means asking again is impossible, not merely rude.
 *
 * iOS is the one platform gate. Before 16.4 there is no web push at all, and
 * from 16.4 there is none in a Safari tab -- only in an app on the home screen.
 * `supported` catches the version, `standalone` catches the tab, and an iOS
 * user in a tab is correctly shown nothing here because `InstallHint` is
 * already telling them about the home screen.
 */
export function shouldAskForPush(state: PushAskState): boolean {
  if (!state.supported || !state.configured || !state.identified) return false;
  if (state.subscribed) return false;
  if (state.permission !== "default") return false;
  if (state.dismissed) return false;
  if (state.iosSafari && !state.standalone) return false;
  return true;
}

/**
 * The VAPID public key, as the browser wants it.
 *
 * `applicationServerKey` takes raw bytes; the key is served as base64url,
 * because that is what `web-push` generates and what survives an environment
 * variable. This is the conversion between them, and it is here rather than
 * inline in a component because getting it subtly wrong produces a
 * subscription that is accepted by the browser and rejected by the push
 * service -- a failure that surfaces hours later as silence.
 *
 * Two differences from plain base64: `-` and `_` stand in for `+` and `/`, and
 * the `=` padding is dropped. Both are undone before `atob`, which accepts
 * neither.
 */
export function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = base64Url.padEnd(base64Url.length + ((4 - (base64Url.length % 4)) % 4), "=");
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  // Backed by an explicit `ArrayBuffer` rather than the bare length overload,
  // which types as `ArrayBufferLike` and so could be a `SharedArrayBuffer`.
  // `applicationServerKey` takes a `BufferSource`, and a shared buffer is not
  // one -- the difference is invisible at runtime and a compile error here.
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * What to say when the browser refuses, in words that name the way out.
 *
 * `denied` is the one that needs it. It is not a failure anything in this app
 * can retry -- the permission is remembered by the browser, not by us, and the
 * only undo is in the browser's own site settings. Saying "something went
 * wrong" there would send someone tapping a button that can never work again.
 */
export function permissionMessage(permission: PushPermission): string | null {
  if (permission === "granted") return null;
  if (permission === "denied") {
    return "Your browser is blocking notifications for Questly. Turn them back on in its site settings for this page, then try again.";
  }
  return "Notifications were not turned on.";
}
