import { describe, expect, test } from "vitest";
import { badgeLabel, initialsFor, NO_NAME_INITIAL } from "./avatar";
// Relative, not the `@convex` alias: that path is a tsconfig mapping the
// bundler resolves, and vitest.config.ts declares no aliases of its own.
import { MAX_AVATAR_BYTES, refuseAvatar } from "../../convex/lib/avatar";

/**
 * The initials are what almost every account shows, because almost nobody
 * uploads a picture. Getting them wrong is not cosmetic: the roundel is how
 * somebody tells which account a shared browser is holding.
 */
describe("the mark in an empty roundel", () => {
  test("two words give two initials", () => {
    expect(initialsFor("Bec Chen")).toBe("BC");
  });

  test("one word gives one, not a padded pair", () => {
    expect(initialsFor("Bec")).toBe("B");
  });

  test("the first and last word, the way a person signs it", () => {
    // Not BV. Somebody called "Bec van der Meer" writes BM.
    expect(initialsFor("Bec van der Meer")).toBe("BM");
  });

  test("a hyphenated or apostrophed name is one word", () => {
    // Splitting on the punctuation hands people initials they would never use.
    expect(initialsFor("Anne-Marie")).toBe("A");
    expect(initialsFor("O'Brien")).toBe("O");
  });

  test("leading punctuation is skipped, not taken", () => {
    expect(initialsFor("(bec) chen")).toBe("BC");
  });

  test("names outside the Latin alphabet keep their own initial", () => {
    // A [A-Za-z] check would drop these and show the fallback mark to somebody
    // whose name is perfectly ordinary where they live.
    expect(initialsFor("Đức Minh")).toBe("ĐM");
    expect(initialsFor("Ólafur")).toBe("Ó");
  });

  test("a name with nothing to take from falls back rather than rendering empty", () => {
    // An empty circle reads as a rendering fault; a mark reads as an account.
    expect(initialsFor("")).toBe(NO_NAME_INITIAL);
    expect(initialsFor("   ")).toBe(NO_NAME_INITIAL);
    expect(initialsFor(null)).toBe(NO_NAME_INITIAL);
    expect(initialsFor(undefined)).toBe(NO_NAME_INITIAL);
    expect(initialsFor("!!!")).toBe(NO_NAME_INITIAL);
  });

  test("never more than two characters, however many words there are", () => {
    expect(initialsFor("a b c d e f g")).toHaveLength(2);
  });

  test("lowercase input is uppercased, because the roundel is a signage face", () => {
    expect(initialsFor("bec chen")).toBe("BC");
  });
});

describe("what a screen reader is told", () => {
  test("the name, not the abbreviation", () => {
    // "BC" is announced "bee see", which says nothing about whose account it is.
    expect(badgeLabel("Bec Chen")).toBe("Account menu for Bec Chen");
  });

  test("still says what the control does when there is no name", () => {
    expect(badgeLabel(null)).toBe("Account menu");
    expect(badgeLabel("  ")).toBe("Account menu");
  });
});

describe("what an upload is allowed to be", () => {
  test("the four formats a browser can be relied on to draw", () => {
    for (const type of ["image/png", "image/jpeg", "image/webp", "image/gif"]) {
      expect(refuseAvatar({ type, size: 1000 })).toBeNull();
    }
  });

  test("SVG is refused, because it is a script surface as much as an image", () => {
    // A `startsWith("image/")` check would let this through.
    expect(refuseAvatar({ type: "image/svg+xml", size: 1000 })).toBe("TYPE");
  });

  test("a non-image is refused", () => {
    expect(refuseAvatar({ type: "application/pdf", size: 1000 })).toBe("TYPE");
    expect(refuseAvatar({ type: "", size: 1000 })).toBe("TYPE");
  });

  test("the ceiling is inclusive, so a file exactly at the limit is fine", () => {
    expect(refuseAvatar({ type: "image/png", size: MAX_AVATAR_BYTES })).toBeNull();
    expect(refuseAvatar({ type: "image/png", size: MAX_AVATAR_BYTES + 1 })).toBe("SIZE");
  });

  test("type is checked before size, so the message names the real problem", () => {
    // A 5MB PDF is not "too big", it is not a picture.
    expect(refuseAvatar({ type: "application/pdf", size: MAX_AVATAR_BYTES * 3 })).toBe("TYPE");
  });
});
