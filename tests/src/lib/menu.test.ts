import { describe, expect, test } from "vitest";
import { menuKey, openIndex } from "../../../src/lib/menu";

/**
 * A menu that opens on click and cannot be driven from the keyboard is a
 * control a keyboard user can reach and not use -- worse than no menu. Two
 * roundels in the header open one, so the rule is tested once here rather than
 * trusted twice in components this suite has no DOM to render.
 */
describe("moving through a menu", () => {
  test("down and up step by one", () => {
    expect(menuKey("ArrowDown", 0, 3)).toEqual({ kind: "move", index: 1 });
    expect(menuKey("ArrowUp", 2, 3)).toEqual({ kind: "move", index: 1 });
  });

  test("both ends wrap, so overshooting does not require reversing", () => {
    expect(menuKey("ArrowDown", 2, 3)).toEqual({ kind: "move", index: 0 });
    expect(menuKey("ArrowUp", 0, 3)).toEqual({ kind: "move", index: 2 });
  });

  test("Home and End jump the length of the menu", () => {
    expect(menuKey("Home", 2, 3)).toEqual({ kind: "move", index: 0 });
    expect(menuKey("End", 0, 3)).toEqual({ kind: "move", index: 2 });
  });

  test("moving does not choose, because a menu item is a command", () => {
    // The listbox pattern selects as it moves; the menu pattern must not, or
    // arrowing past "Delete account" would trigger it.
    expect(menuKey("ArrowDown", 0, 3)?.kind).toBe("move");
  });
});

describe("leaving a menu", () => {
  test("Escape closes it and hands focus back to the button", () => {
    // Without the restore, dismissing drops focus to <body> and a keyboard
    // user restarts from the top of the document.
    expect(menuKey("Escape", 1, 3)).toEqual({ kind: "close", restoreFocus: true });
  });

  test("Tab closes it and lets the browser carry on", () => {
    expect(menuKey("Tab", 1, 3)).toEqual({ kind: "close", restoreFocus: false });
  });

  test("Escape still works on an empty menu", () => {
    expect(menuKey("Escape", -1, 0)).toEqual({ kind: "close", restoreFocus: true });
  });
});

describe("keys that are not ours", () => {
  test("an unhandled key returns null so the caller does not preventDefault", () => {
    // Swallowing these stops Tab working and stops anything else on the page
    // hearing a keystroke again.
    expect(menuKey("a", 0, 3)).toBeNull();
    expect(menuKey("F5", 0, 3)).toBeNull();
    expect(menuKey("ArrowRight", 0, 3)).toBeNull();
  });

  test("an empty menu swallows nothing but Escape", () => {
    expect(menuKey("ArrowDown", -1, 0)).toBeNull();
    expect(menuKey("Enter", -1, 0)).toBeNull();
  });
});

describe("choosing", () => {
  test("Enter and Space both activate the focused item", () => {
    expect(menuKey("Enter", 2, 3)).toEqual({ kind: "activate", index: 2 });
    expect(menuKey(" ", 2, 3)).toEqual({ kind: "activate", index: 2 });
  });
});

describe("where focus lands when the menu opens", () => {
  test("a pointer opens it with nothing focused", () => {
    // Everything is visible already; pre-focusing announces a choice nobody made.
    expect(openIndex("pointer", 3)).toBe(-1);
  });

  test("Down opens on the first item, so the next Down is not wasted", () => {
    expect(openIndex("ArrowDown", 3)).toBe(0);
  });

  test("Up opens on the last, which is the whole reason for two keys", () => {
    expect(openIndex("ArrowUp", 3)).toBe(2);
  });

  test("Enter and Space open on the first item", () => {
    expect(openIndex("Enter", 3)).toBe(0);
    expect(openIndex(" ", 3)).toBe(0);
  });

  test("an empty menu focuses nothing rather than index zero", () => {
    expect(openIndex("ArrowDown", 0)).toBe(-1);
    expect(openIndex("ArrowUp", 0)).toBe(-1);
  });
});
