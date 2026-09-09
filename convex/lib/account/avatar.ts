/**
 * What an avatar upload is allowed to be.
 *
 * Here rather than in `src/lib` because BOTH ends need it and they must not
 * drift: the browser checks before spending a phone's upload budget on a file
 * that will be refused, and `profiles.setAvatar` checks again after the bytes
 * land, because anything the browser enforces the browser can also skip. Same
 * arrangement as `convex/lib/account.ts`, which the restore screen imports for
 * exactly the same reason.
 */

/**
 * Two megabytes. This image is only ever drawn at 44px, and the upload happens
 * on a phone, on tram wifi, on a screen somebody is trying to get through.
 * Anything larger is an unresized photo that will spend longer uploading than
 * the whole settings screen is worth.
 */
export const MAX_AVATAR_MB = 2;
export const MAX_AVATAR_BYTES = MAX_AVATAR_MB * 1024 * 1024;

/**
 * Deliberately a list, not a `startsWith("image/")` check. SVG is an image by
 * that measure and is also a script-execution surface, so it is refused here
 * rather than left for a Content-Security-Policy to catch later.
 */
export const AVATAR_TYPES: readonly string[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];

export type AvatarRefusal = "TYPE" | "SIZE" | null;

/**
 * `null` means acceptable. The caller turns a refusal into a sentence, because
 * the sentence belongs to the screen and this belongs to both ends of the wire.
 */
export function refuseAvatar(file: { type: string; size: number }): AvatarRefusal {
  if (!AVATAR_TYPES.includes(file.type)) return "TYPE";
  if (file.size > MAX_AVATAR_BYTES) return "SIZE";
  return null;
}
