"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { menuKey, openIndex } from "@/lib/menu";

/**
 * A roundel that opens a menu.
 *
 * The roundel is this product's own primitive, not a borrowed avatar-and-caret
 * kit: `globals.css` describes the design as "Melbourne transit wayfinding --
 * iris ground, one orange route line, roundel nodes", and `.node` already draws
 * stops on that line as circles. The colour mode and the account badge are both
 * nodes in the header, so they are both drawn as one and they both open the
 * same kind of menu. One interaction to learn, used twice, rather than two.
 *
 * WHY THE MENU SURFACE IS `--ground` AND NOT `--ground-raised`, which is what a
 * popover would normally sit on: `--text-dim` and `--danger` are measured
 * against `--ground` (5.26:1 and 5.03:1 in dark, 6.21:1 and 6.30:1 in light).
 * Against `--ground-raised` those are different numbers that nobody in this
 * repository has measured, and DESIGN's standing rule -- after a review found
 * nineteen written ratios wrong -- is that new markup reuses pairings that have
 * been computed rather than claiming new ones. So the menu keeps the ground it
 * can prove, and the `--text-dim` border does the separating that a raised fill
 * would otherwise do. `--hairline` would not: it is 1.44:1 and no better than
 * drawing nothing.
 */

export type MenuItem = {
  label: string;
  /** Where it goes. Mutually exclusive with `onSelect`, like `Plate`'s. */
  href?: string;
  onSelect?: () => void;
  /**
   * Destructive items are separated and coloured, never colour alone -- the
   * rule that runs through the rest of this codebase. `--danger` on `--ground`
   * is the one measured pairing, which is the other reason this menu does not
   * sit on a raised fill.
   */
  destructive?: boolean;
  /**
   * A drawn mark from `icons.tsx`. It inherits the row's `currentColor`, which
   * is how it stays on a pairing somebody has already measured: `--text` and
   * `--danger` are both computed against `--ground`, and this menu sits on
   * `--ground` precisely so those numbers hold.
   *
   * On the destructive row this is not decoration. That row was told apart by
   * colour and position alone, and "never colour alone" is a rule this
   * codebase states in `Plate`, in `Chip` and in DESIGN.
   */
  icon?: ReactNode;
};

type Props = {
  /** What is drawn inside the circle: initials, an image, or a glyph. */
  children: ReactNode;
  /** The accessible name. The visible content is an abbreviation or a picture. */
  label: string;
  items: MenuItem[];
  /** Filled roundels carry the account; outlined ones carry a setting. */
  filled?: boolean;
};

export function MenuRoundel({ children, label, items, filled = false }: Props) {
  const router = useRouter();
  const id = useId();

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const button = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | HTMLAnchorElement | null>>([]);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    setActive(-1);
    if (restoreFocus) button.current?.focus();
  }, []);

  /**
   * Dismissing by clicking elsewhere, and by the window going away.
   *
   * `pointerdown` rather than `click`: a click on another button would
   * otherwise fire that button AND leave this menu open behind it. Listening on
   * the capture phase means a click on a menu item still reaches the item
   * first, which is why the containing element is checked rather than closing
   * unconditionally.
   *
   * Not focus-based, because focus leaves this subtree on the way to a `href`
   * navigation as well, and closing on that races the route change.
   */
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && button.current?.parentElement?.contains(target)) return;
      close(false);
    }
    // A menu open across a route change is a menu floating over a screen it
    // does not belong to.
    function onScrollOrResize() {
      close(false);
    }

    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, close]);

  // Focus follows the roving index. Moving focus is what makes the arrow keys
  // real: without it a screen reader announces nothing as the index changes.
  useEffect(() => {
    if (open && active >= 0) itemRefs.current[active]?.focus();
  }, [open, active]);

  function openWith(key: "pointer" | "ArrowDown" | "ArrowUp" | "Enter" | " ") {
    setOpen(true);
    setActive(openIndex(key, items.length));
  }

  function onButtonKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openWith(event.key);
      return;
    }
    if (open && event.key === "Escape") {
      event.preventDefault();
      close(true);
    }
  }

  function choose(item: MenuItem) {
    // Closed BEFORE the action, so a navigation does not leave a menu hanging
    // over the screen it arrives on. `restoreFocus: false` because the action
    // is about to put focus somewhere real -- a new route, or a control the
    // handler focuses itself.
    close(false);
    if (item.onSelect) item.onSelect();
    else if (item.href) router.push(item.href);
  }

  function onItemKeyDown(event: React.KeyboardEvent, index: number) {
    const action = menuKey(event.key, index, items.length);
    // `null` means the key is not ours: do NOT preventDefault, or Tab stops
    // working and nothing else on the page hears a keystroke again.
    if (!action) return;
    event.preventDefault();

    if (action.kind === "move") setActive(action.index);
    else if (action.kind === "close") close(action.restoreFocus);
    else choose(items[action.index]);
  }

  return (
    <div className="relative">
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => (open ? close(false) : openWith("pointer"))}
        onKeyDown={onButtonKeyDown}
        // 44px, this product's target floor, and the circle IS the target --
        // the same rule the header link beside it follows. `overflow-hidden`
        // so an uploaded picture is clipped to the roundel rather than drawn
        // square inside it.
        className={`board flex size-[44px] shrink-0 items-center justify-center overflow-hidden rounded-full border text-[11px] ${
          filled
            ? // The account roundel is a FILLED node, the way `.node[data-state="locked"]`
              // fills a stop that is settled. `--action` carries `--on-action`
              // at 4.92:1 in both modes, and `--action-edge` draws the boundary
              // the fill cannot: orange on iris is 2.95:1, under SC 1.4.11's
              // 3:1. Exactly the pairing `Plate`'s action variant uses.
              "border-action-edge bg-action text-on-action"
            : // The setting roundel is a HOLLOW node -- open, not locked.
              // `--text-dim` is 5.26:1 dark / 6.21:1 light on `--ground`, which
              // clears the 3:1 a control's boundary needs with room to spare,
              // and `--accent` carries the glyph at 5.68:1 / 9.57:1.
              "border-dim bg-transparent text-accent"
        }`}
      >
        {children}
      </button>

      {open ? (
        <div
          id={id}
          role="menu"
          aria-label={label}
          // Right-aligned to the roundel, because both roundels live at the
          // right edge of a header and a left-aligned menu would open off the
          // screen on a phone.
          className="absolute right-0 z-50 mt-2 flex min-w-[184px] flex-col rounded-[6px] border border-dim bg-ground p-[6px]"
          style={{ boxShadow: "var(--shadow)" }}
        >
          {items.map((item, i) => {
            const separated = item.destructive && i > 0;
            return (
              <div key={item.label} className={separated ? "mt-[6px] border-t border-dim pt-[6px]" : ""}>
                <button
                  ref={(node) => {
                    itemRefs.current[i] = node;
                  }}
                  type="button"
                  role="menuitem"
                  // One tab stop for the whole menu: the arrow keys move
                  // within it, Tab leaves it. The WAI-ARIA menu pattern, and
                  // the same roving-tabindex shape the colour switch used
                  // before this replaced it.
                  tabIndex={i === active ? 0 : -1}
                  onClick={() => choose(item)}
                  onKeyDown={(event) => onItemKeyDown(event, i)}
                  // Full width so the target is the row, not the words. 44px
                  // tall for the same reason every other control here is.
                  className={`flex min-h-[44px] w-full items-center gap-3 rounded-[4px] px-3 text-left text-[15px] leading-snug ${
                    item.destructive ? "text-danger" : "text-text"
                  }`}
                >
                  {/* Laid out the way `Plate` already lays out its own icon
                      and label, so a row here and a row there are the same
                      row. */}
                  {item.icon ? <span className="shrink-0">{item.icon}</span> : null}
                  <span className="min-w-0 flex-1">{item.label}</span>
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
