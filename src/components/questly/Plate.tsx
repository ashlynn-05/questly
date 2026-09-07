"use client";

import type { ReactNode } from "react";
import Link from "next/link";

type Variant = "action" | "quiet" | "raised" | "ghost";

const SURFACE: Record<Variant, string> = {
  // Orange is a FIELD colour. It carries --on-action ink, never its own text.
  //
  // The border is not decoration either. Orange fill against `--ground`
  // measures 2.95:1 in dark mode, under the 3:1 SC 1.4.11 asks of a control's
  // visual boundary, and `--action` cannot move -- `--on-action` is exactly
  // 4.92:1 on it, with no headroom. So the edge carries the boundary instead:
  // `--action-edge` is white in dark (10.20:1 on iris, 3.46:1 on the fill) and
  // ink in light (15.97:1 on cornsilk, 4.92:1 on the fill), clearing 3:1 on
  // both sides of the line it draws. See globals.css.
  action: "bg-action text-on-action border border-action-edge",
  // Same edge, same reason, and worse without it: in LIGHT mode `--action-quiet`
  // is jonquil, which measures 1.38:1 on cornsilk -- a control with no visible
  // boundary at all. The ink edge puts that at 15.97:1 against the ground and
  // 11.58:1 against the fill. (Dark mode's deep orange already clears 3:1 on
  // iris at 3.90:1; it carries the edge for consistency, not to be rescued.)
  quiet: "bg-action-quiet text-on-action border border-action-edge",
  raised: "bg-ground-raised text-text",
  ghost: "bg-transparent text-text border border-hairline",
};

/**
 * What a disabled Plate looks like, and why it is not simply the enabled one
 * turned down.
 *
 * This used to be `disabled:opacity-50`, which contradicted the rule written
 * forty lines below it in this same file. Half opacity composites the WHOLE
 * control -- fill, label and edge -- over the page, so on `variant="action"`
 * the label fell from 4.92:1 to 2.17:1 in dark and 1.86:1 in light, the fill's
 * boundary against the ground fell to 1.64:1, and the edge to 2.34:1. WCAG
 * exempts inactive controls; this project's Global Constraint does not, and
 * `join/[code]/page.tsx` disables its primary CTA whenever the name field is
 * empty -- which is its state at the moment an invited guest arrives from a
 * group chat. The first thing they saw was a 2.17:1 call to action.
 *
 * So a disabled Plate LOSES its fill instead of dimming its ink. What is left
 * is the same treatment `Chip` already uses for an unselected option: a dashed
 * `--text-dim` boundary around `--text-dim` text, on the `--ground` these
 * controls all sit on. Both measure 5.26:1 in dark and 6.21:1 in light -- over
 * the 4.5:1 text floor and the 3:1 boundary floor, disabled or not. Dashed,
 * because "not available yet" should not rest on colour alone either.
 */
const DISABLED_SURFACE = "bg-transparent text-dim border border-dashed border-dim";

/**
 * `sub`'s tone per variant. `action` and `quiet` sit on an orange field:
 * --text-dim is only measured against `--ground`, so there is no token that
 * holds AA contrast dimmed on orange, and opacity is not a permitted
 * substitute (see Plate below). Those two variants get no dimming at all --
 * `sub` inherits the surface's full-contrast ink.
 *
 * `raised` sits on `--ground-raised`, a lighter fill than the `--ground` that
 * `--text-dim` is actually measured against -- it happens to still clear AA
 * there (4.52:1 dark, 5.24:1 light), but that is this surface's own number,
 * not the token's tested pairing carrying over. `ghost` is transparent, so
 * `text-dim` is only as safe as whatever is behind it: on `--ground` it holds;
 * on an orange field -- `--action` or `--action-quiet` -- it does not. In dark,
 * text-dim on `--action` measures 1.79:1 and on `--action-quiet` 1.35:1; in
 * light, 1.91:1 and 4.50:1. Three of those four are under the 4.5:1 floor and
 * the fourth has no margin worth spending. Never stack a `ghost` Plate over an
 * orange background.
 */
const SUB_TONE: Record<Variant, string> = {
  action: "",
  quiet: "",
  raised: "text-dim",
  ghost: "text-dim",
};

type CommonProps = {
  variant?: Variant;
  selected?: boolean;
  label: string;
  sub?: string;
  right?: ReactNode;
  icon?: ReactNode;
  /** Centers `label`/`sub`, for a plain CTA with no `icon`/`right` sibling to balance against. */
  center?: boolean;
  className?: string;
};

/**
 * A link and a button are different controls, so their props are mutually
 * exclusive rather than merged into one shape a caller could misuse: a
 * `href` plate always navigates (middle-click, open-in-new-tab, no
 * `disabled` state a link cannot express), a `href`-less one is always a
 * `<button>` that may take `onClick`/`disabled`. Passing `disabled` or
 * `onClick` alongside `href` is a type error, not a silently-ignored prop.
 */
type LinkProps = CommonProps & {
  href: string;
  onClick?: never;
  disabled?: never;
};

type ButtonProps = CommonProps & {
  href?: never;
  onClick?: () => void;
  disabled?: boolean;
};

type Props = LinkProps | ButtonProps;

/**
 * min-h-[44px] is not decoration: WCAG 2.2 AA target size is a product
 * requirement here, and these are the controls a whole group taps at once on
 * phones held one-handed.
 *
 * `label` never carries opacity, in any state, disabled included: --on-action
 * is measured at exactly 4.92:1 on orange, and any opacity tint at all drops
 * that below the 4.5:1 AA floor. See DISABLED_SURFACE above. `label`
 * is also the required prop -- what a screen reader announces first and what
 * a hurried thumb aims at -- so it renders at least as large as the optional
 * `sub`, never smaller. Hierarchy between the two comes from the `.board`
 * treatment (uppercase, tracked, a different weight), never from dimming.
 */
export function Plate(props: Props) {
  const {
    variant = "raised",
    selected = false,
    label,
    sub,
    right,
    icon,
    center = false,
    className = "",
  } = props;

  // Resolved here rather than through a `disabled:` variant, so there is never
  // a moment where two conflicting utilities are both in the class list and
  // the cascade order decides which surface a control wears.
  const disabled = props.href ? false : props.disabled === true;

  const base = [
    "flex min-h-[44px] w-full items-center gap-3 rounded-[6px] px-4 py-3",
    center ? "text-center justify-center" : "text-left",
    "transition-[transform,background-color] duration-150",
    "active:translate-y-[1px] disabled:pointer-events-none",
    disabled ? DISABLED_SURFACE : SURFACE[variant],
    // The offset gap is transparent, not a hardcoded surface colour: a
    // filled gap paints a wrong-colour halo on any Plate that isn't sitting
    // directly on `--ground` (a raised card, a modal, a ghost stack).
    selected ? "ring-2 ring-accent ring-offset-2 ring-offset-transparent" : "",
    className,
  ].join(" ");

  const inner = (
    <>
      {icon ? <span className="shrink-0">{icon}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="board block text-[13px]">{label}</span>
        {sub ? (
          <span
            className={[
              "mt-1 block text-[11px] leading-snug",
              // A disabled plate is already entirely `--text-dim`; dimming
              // inside it would be dimming a dim.
              disabled ? "" : SUB_TONE[variant],
            ].join(" ")}
          >
            {sub}
          </span>
        ) : null}
      </span>
      {right ? <span className="num shrink-0 text-[15px]">{right}</span> : null}
    </>
  );

  // A navigation control stays a link, so middle-click and open-in-new-tab
  // work. `href` is `never` on ButtonProps, so this also narrows `props` to
  // LinkProps for the branch below -- the discriminant IS the prop.
  if (props.href) {
    return (
      <Link href={props.href} aria-current={selected ? "page" : undefined} className={base}>
        {inner}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      // Keyed on whether `selected` was PASSED, not on whether it is true.
      // A caller that passes it is describing a toggle, and an unselected
      // toggle must still say so (`aria-pressed="false"`) or a screen reader
      // cannot tell it is one. A caller that omits it is a one-shot action
      // ("Copy join link"), and gets no attribute at all -- announcing every
      // CTA in the app as a toggle button would be worse than saying nothing.
      aria-pressed={props.selected}
      className={base}
    >
      {inner}
    </button>
  );
}
