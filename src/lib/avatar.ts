/**
 * What a person's roundel says when there is no picture in it.
 *
 * Pure, and here rather than in the component, for the reason every other
 * decision in `src/lib` is: the test suite runs one `edge-runtime` environment
 * with no DOM, so a rule that lives inside a component cannot be tested at all.
 *
 * The rules are about names as people actually write them, not about splitting
 * on a space:
 *
 *  - Two initials when there are two words worth taking them from, one when
 *    there is not. "Bec Chen" is BC; "Bec" is B.
 *  - Hyphenated and apostrophed names are ONE word. "Anne-Marie" is A, not AM,
 *    and "O'Brien" is O -- treating the punctuation as a break gives people
 *    initials they would never write themselves.
 *  - Anything that is not a letter or a digit is skipped when looking for the
 *    character to take. A name written "(bec)" still starts with B.
 *  - The first and LAST word, not the first two: "Bec van der Meer" is BM, the
 *    way a person signs it, not BV.
 *
 * `MAX_DISPLAY_NAME` allows 40 characters, so this walks a bounded string.
 */
const MAX_INITIALS = 2;

/**
 * The one shown when there is no name either -- a signed-in account that has
 * not finished the quiz, or a Better Auth record with an empty name. A filled
 * roundel with a neutral mark reads as "an account", which is true, where an
 * empty circle reads as a rendering fault.
 */
export const NO_NAME_INITIAL = "?";

/** The first letter or digit in a word, uppercased. Empty if it has none. */
function leadingCharacter(word: string): string {
  for (const character of word) {
    // Unicode-aware on purpose: this product is used in Melbourne and a name
    // is not required to be ASCII. `\p{L}` and `\p{N}` cover the letter and
    // number that a Latin-only [A-Za-z0-9] would silently drop, which would
    // hand somebody the fallback mark instead of their own initial.
    if (/[\p{L}\p{N}]/u.test(character)) return character.toLocaleUpperCase();
  }
  return "";
}

export function initialsFor(displayName: string | null | undefined): string {
  const words = (displayName ?? "")
    .split(/\s+/)
    .map(leadingCharacter)
    .filter((initial) => initial !== "");

  if (words.length === 0) return NO_NAME_INITIAL;
  if (words.length === 1) return words[0];
  return (words[0] + words[words.length - 1]).slice(0, MAX_INITIALS);
}

/**
 * What the screen reader says for the badge.
 *
 * The visible initials are an abbreviation and must not be the accessible name:
 * "BC" is announced as "bee see", which tells somebody nothing about whose
 * account this is or what the control does. The control is a menu button, so
 * the name says both.
 */
export function badgeLabel(displayName: string | null | undefined): string {
  const name = (displayName ?? "").trim();
  return name ? `Account menu for ${name}` : "Account menu";
}
