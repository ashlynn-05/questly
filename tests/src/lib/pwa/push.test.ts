import { describe, expect, test } from "vitest";
import {
  PUSH_ASK_DISMISSED_KEY,
  permissionMessage,
  shouldAskForPush,
  urlBase64ToUint8Array,
  type PushAskState,
} from "../../../../src/lib/pwa/push";

/**
 * The pure half of the browser side, which is the only half this suite can
 * reach: vitest runs `edge-runtime` here, with no `Notification`, no
 * `PushManager` and no `navigator`. Every rule about WHEN to ask lives in
 * `src/lib/push.ts` for exactly that reason, and this is where it is held.
 */

/** Everything true, so each case below changes exactly one thing. */
const READY: PushAskState = {
  supported: true,
  configured: true,
  identified: true,
  subscribed: false,
  permission: "default",
  dismissed: false,
  iosSafari: false,
  standalone: false,
};

test("the key is the questly-prefixed one the rest of the app uses", () => {
  expect(PUSH_ASK_DISMISSED_KEY).toBe("questly-push-ask-dismissed");
});

test("a browser that can receive them, on a deployment that can send them, is asked", () => {
  expect(shouldAskForPush(READY)).toBe(true);
});

describe("and is not asked when", () => {
  const cases: [string, Partial<PushAskState>][] = [
    ["the browser has no push at all", { supported: false }],
    ["the deployment has no VAPID keys", { configured: false }],
    ["there is nobody to file a subscription under", { identified: false }],
    ["this browser is already subscribed", { subscribed: true }],
    // The important half of this pair: `denied` is permanent and only the
    // browser's own settings can undo it, so asking again is impossible rather
    // than merely rude.
    ["permission was already refused", { permission: "denied" }],
    ["permission was already given", { permission: "granted" }],
    ["they said not now before", { dismissed: true }],
    // iOS has no web push in a Safari tab at all, only in an installed app.
    // `InstallHint` is already telling them about the home screen.
    ["it is iOS Safari in a tab", { iosSafari: true, standalone: false }],
  ];

  for (const [when, change] of cases) {
    test(when, () => {
      expect(shouldAskForPush({ ...READY, ...change })).toBe(false);
    });
  }
});

test("iOS is asked once the app is on the home screen", () => {
  expect(shouldAskForPush({ ...READY, iosSafari: true, standalone: true })).toBe(true);
});

describe("the VAPID key conversion", () => {
  test("undoes base64url and its missing padding", () => {
    // "\xfb\xff\xbe" -- bytes chosen because they encode to the two characters
    // base64url replaces, `+` and `/`, and to a length that needs padding.
    expect(Array.from(urlBase64ToUint8Array("-_--"))).toEqual([251, 255, 190]);
  });

  test("round-trips a key of the length a real VAPID key has", () => {
    // 65 bytes: an uncompressed P-256 public point, which is what a VAPID
    // public key is and what `applicationServerKey` must be handed.
    const bytes = Uint8Array.from({ length: 65 }, (_, i) => (i * 7) % 256);
    const base64Url = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    expect(Array.from(urlBase64ToUint8Array(base64Url))).toEqual(Array.from(bytes));
  });

  test("produces a buffer a BufferSource argument will accept", () => {
    // Not a `SharedArrayBuffer`, which `applicationServerKey` refuses and which
    // the bare length overload of `Uint8Array` types as possible.
    expect(urlBase64ToUint8Array("-_--").buffer).toBeInstanceOf(ArrayBuffer);
  });
});

describe("what to say when the browser refuses", () => {
  test("nothing at all when it did not", () => {
    expect(permissionMessage("granted")).toBeNull();
  });

  test("a denial names the only place it can be undone", () => {
    expect(permissionMessage("denied")).toMatch(/site settings/i);
  });

  test("a dismissal is not reported as a failure", () => {
    expect(permissionMessage("default")).not.toMatch(/wrong|error|failed/i);
  });
});
