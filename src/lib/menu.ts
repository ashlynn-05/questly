/**
 * The keyboard behaviour a menu button owes, as a pure function.
 *
 * This is the WAI-ARIA menu-button pattern, and it is not optional decoration:
 * a menu that opens on click and then cannot be driven from the keyboard is a
 * control a keyboard user can reach and not use, which is worse than no menu.
 * Two roundels in this product's header now open one -- the colour mode and the
 * account badge -- and they must behave identically, so the rule lives once,
 * here, where the DOM-less test suite can actually reach it.
 *
 * Roving focus, not a listbox: a menu item is a command, so moving to it does
 * NOT choose it. Nothing here activates anything; the caller does that on Enter
 * or on click.
 */
export type MenuAction =
  | { kind: "move"; index: number }
  | { kind: "close"; restoreFocus: boolean }
  | { kind: "activate"; index: number }
  | null;

/**
 * `null` means "not ours" -- the caller must NOT call preventDefault, or Tab
 * stops working and typing stops reaching the page.
 *
 * Wrapping is deliberate at both ends: Down from the last item returns to the
 * first. It is what the pattern specifies, and on a three-item menu the wrap is
 * how somebody who overshot gets back without reversing.
 */
export function menuKey(key: string, index: number, count: number): MenuAction {
  if (count <= 0) return key === "Escape" ? { kind: "close", restoreFocus: true } : null;

  switch (key) {
    case "ArrowDown":
      return { kind: "move", index: (index + 1) % count };
    case "ArrowUp":
      return { kind: "move", index: (index - 1 + count) % count };
    case "Home":
      return { kind: "move", index: 0 };
    case "End":
      return { kind: "move", index: count - 1 };
    case "Enter":
    case " ":
      return { kind: "activate", index };
    case "Escape":
      // Focus goes back to the button that opened this. Without it, dismissing
      // a menu drops focus to <body> and a keyboard user restarts from the top
      // of the document -- the same defect the room's screen transitions move
      // focus to a heading to avoid.
      return { kind: "close", restoreFocus: true };
    case "Tab":
      // Tab dismisses and lets the browser move on by itself. Not
      // `restoreFocus`, because the whole point of the key is to leave.
      return { kind: "close", restoreFocus: false };
    default:
      return null;
  }
}

/**
 * Which item is focused when the menu opens, which depends on how it was
 * opened.
 *
 * A pointer opens the menu with nothing focused (-1): the person can already
 * see every item and pre-focusing one would announce a choice they did not
 * make. A keyboard opens it ON an item, because otherwise the next Down arrow
 * is spent getting into a menu that is already open -- and Up opens on the
 * LAST item, which is the whole reason the pattern has two keys for one action.
 */
export function openIndex(key: "pointer" | "ArrowDown" | "ArrowUp" | "Enter" | " ", count: number): number {
  if (count <= 0) return -1;
  if (key === "ArrowUp") return count - 1;
  if (key === "pointer") return -1;
  return 0;
}
