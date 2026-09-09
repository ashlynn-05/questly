/**
 * The two questions the install hint has to answer, as functions of their
 * inputs rather than of the browser.
 *
 * Pure for the same reason `theme.ts` is: the suite runs on `edge-runtime`
 * (see `vitest.config.ts`), which has no `navigator` and no `matchMedia`, so
 * anything that reads them directly is untestable here. The DOM reads live in
 * `InstallHint.tsx` and are two lines; every rule about what those two lines
 * MEAN lives in this file, next to its test.
 */

/** Where the dismissal is remembered. One key, named once, as with the theme. */
export const INSTALL_HINT_DISMISSED_KEY = "questly-install-hint-dismissed";

/**
 * Is this Safari on iOS -- the one browser that has no `beforeinstallprompt`
 * and therefore needs a sentence telling the user where the button is?
 *
 * Three traps, all of them things the naive `/iPhone|iPad/` check gets wrong:
 *
 * - Chrome, Firefox and Edge on iOS are Safari's engine in someone else's
 *   shell, and their Share menu has no "Add to Home Screen" that installs a
 *   web app. Instructions for Safari would be instructions for a menu item
 *   that is not there, so they are excluded by their own tokens (CriOS, FxiOS,
 *   EdgiOS).
 * - An iPad on iPadOS 13+ reports itself as "Macintosh" by default. It is
 *   still the platform that needs the hint, and the giveaway is a Mac UA with
 *   touch -- which is why `maxTouchPoints` is an argument here.
 * - A real Mac running desktop Safari installs from the File menu and needs
 *   none of this.
 */
export function isIosSafari(userAgent: string, maxTouchPoints: number): boolean {
  // Every iOS browser carries one of these; taking them first means the
  // WebKit-shell browsers never reach the Safari test below.
  if (/CriOS|FxiOS|EdgiOS|OPiOS|Chrome|Android/.test(userAgent)) return false;

  const iosDevice = /iPhone|iPod|iPad/.test(userAgent);
  // iPadOS in its default "Desktop" mode. A Mac has no touch screen, so
  // touch points on a Macintosh UA is an iPad and nothing else.
  const iPadPretendingToBeAMac = /Macintosh/.test(userAgent) && maxTouchPoints > 1;

  return (iosDevice || iPadPretendingToBeAMac) && /Safari/.test(userAgent);
}

/**
 * Is the app already running from the home screen or a PWA window?
 *
 * Two signals because neither covers everything: `display-mode: standalone`
 * is the standard and is what Android Chrome and desktop PWAs report, while
 * iOS Safari has answered `navigator.standalone` since long before it
 * supported the media query and still does. Either one being true is enough --
 * the question is "is there anything left to install", and one yes settles it.
 */
export function isStandalone(displayModeStandalone: boolean, navigatorStandalone: boolean | undefined): boolean {
  return displayModeStandalone || navigatorStandalone === true;
}
