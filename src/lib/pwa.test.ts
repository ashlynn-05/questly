import { expect, test } from "vitest";
import { isIosSafari, isStandalone } from "./pwa";

/**
 * The install hint is shown to exactly one audience -- Safari on iOS, not yet
 * installed -- and both ways of being wrong are user-visible: instructions on a
 * browser whose Share menu has no "Add to Home Screen", or no instructions on
 * the one platform that offers no install button of its own.
 *
 * Real user-agent strings, not sketches. Every trap in `isIosSafari` is a trap
 * because a real string looks like something it is not: iOS Chrome carries
 * "Safari", an iPad carries "Macintosh".
 */
const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  ipadSafariMobileMode:
    "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  // iPadOS 13+ default. Identical to a Mac apart from the touch screen.
  ipadDesktopMode:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  iosChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1",
  iosFirefox:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15",
  iosEdge:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 EdgiOS/126.0.2592.87 Mobile/15E148 Safari/604.1",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  desktopChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
};

const IOS_SAFARI: Array<{ name: string; ua: string; touch: number; expected: boolean }> = [
  { name: "an iPhone in Safari", ua: UA.iphoneSafari, touch: 5, expected: true },
  { name: "an iPad reporting itself as an iPad", ua: UA.ipadSafariMobileMode, touch: 5, expected: true },
  { name: "an iPad in its default desktop mode", ua: UA.ipadDesktopMode, touch: 5, expected: true },

  // The WebKit shells. Their Share sheet has no install item, so a hint here
  // sends the user hunting for a menu entry that does not exist.
  { name: "Chrome on iOS", ua: UA.iosChrome, touch: 5, expected: false },
  { name: "Firefox on iOS", ua: UA.iosFirefox, touch: 5, expected: false },
  { name: "Edge on iOS", ua: UA.iosEdge, touch: 5, expected: false },

  // A real Mac. Same UA as the iPad above; the touch screen is the only
  // difference, which is exactly why maxTouchPoints is an argument.
  { name: "Safari on a Mac, which has no touch screen", ua: UA.macSafari, touch: 0, expected: false },
  { name: "Android Chrome, which prompts for itself", ua: UA.androidChrome, touch: 5, expected: false },
  { name: "desktop Chrome", ua: UA.desktopChrome, touch: 0, expected: false },
];

for (const { name, ua, touch, expected } of IOS_SAFARI) {
  test(`the iOS install hint ${expected ? "is" : "is not"} for ${name}`, () => {
    expect(isIosSafari(ua, touch)).toBe(expected);
  });
}

test("a touchscreen Windows laptop is not mistaken for an iPad", () => {
  // The Macintosh-plus-touch rule must not generalise: this UA has touch
  // points and is not Apple's anything.
  expect(isIosSafari(UA.desktopChrome, 10)).toBe(false);
});

const STANDALONE: Array<{ name: string; media: boolean; navigator: boolean | undefined; expected: boolean }> = [
  { name: "a tab in the browser", media: false, navigator: false, expected: false },
  { name: "a browser that does not implement navigator.standalone", media: false, navigator: undefined, expected: false },
  { name: "an installed app on Android or the desktop", media: true, navigator: undefined, expected: true },
  // iOS reported navigator.standalone for years before it matched the media
  // query, and an old installed copy can still be the one launching.
  { name: "an installed app on iOS", media: false, navigator: true, expected: true },
  { name: "an installed app reporting both", media: true, navigator: true, expected: true },
];

for (const { name, media, navigator, expected } of STANDALONE) {
  test(`${name} is ${expected ? "" : "not "}standalone`, () => {
    expect(isStandalone(media, navigator)).toBe(expected);
  });
}
