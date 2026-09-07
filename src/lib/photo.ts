/**
 * The browser's half of the Places photo route.
 *
 * This is the one seam in the product that `tsc` cannot see across. The deck
 * card holds Google's opaque photo *name*, never a media URL, and asks our own
 * deployment for the picture so the API key never reaches a browser. The
 * endpoint on the other side is an `httpAction`, which takes a raw `Request`
 * and has no argument validator at all -- so the query-string contract between
 * the two ends is a pair of string literals in two files, one in `src/` and one
 * in `convex/`. Rename `name` on either side and every card's image breaks at
 * runtime, with a clean compile and a fully green suite. The deck is the
 * product's centrepiece screen.
 *
 * So the two ends are made to fail together instead: the path is built here,
 * once, and `src/lib/photo.test.ts` drives the real `convex/places.ts` handler
 * with a request built by this function. Change either side alone and that test
 * goes red.
 */

/** Google's own ceiling for this route; the endpoint clamps to it as well. */
export const PHOTO_MAX_WIDTH_PX = 800;

/** The path the deployment serves the photo route on. See convex/http.ts. */
export const PHOTO_PATH = "/places/photo";

/**
 * The path-and-query half of a photo request, without an origin.
 *
 * Separate from `photoSrc` below so a test can hand it straight to the
 * handler's own router without inventing a deployment URL.
 */
export function photoPath(photoName: string, maxWidthPx = PHOTO_MAX_WIDTH_PX): string {
  const query = new URLSearchParams({
    name: photoName,
    maxWidthPx: String(maxWidthPx),
  });
  return `${PHOTO_PATH}?${query.toString()}`;
}

/**
 * Where a deck card's picture comes from, or null when there is no picture.
 *
 * A partner's own hosted image wins: it is the picture they supplied. Otherwise
 * the Places photo goes through our deployment, and if this build has no
 * deployment URL configured there is nothing to ask.
 */
export function photoSrc(
  quest: { photoUrl?: string | null; photoName?: string | null },
  convexSiteUrl: string | undefined,
): string | null {
  if (quest.photoUrl) return quest.photoUrl;
  if (quest.photoName && convexSiteUrl) return `${convexSiteUrl}${photoPath(quest.photoName)}`;
  return null;
}
