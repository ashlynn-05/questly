"use client";

import type { ReactNode } from "react";
import Link from "next/link";

type Variant = "action" | "quiet" | "raised" | "ghost";

const SURFACE: Record<Variant, string> = {
  // Orange is a FIELD colour. It carries --on-action ink, never its own text.
  action: "bg-action text-on-action",
  quiet: "bg-action-quiet text-on-action",
  raised: "bg-ground-raised text-text",
  ghost: "bg-transparent text-text border border-hairline",
};

/**
 * `sub`'s tone per variant. `action` and `quiet` sit on an orange field:
 * --text-dim is only measured against `--ground`, so there is no token that
 * holds AA contrast dimmed on orange, and opacity is not a permitted
 * substitute (see Plate below). Those two variants get no dimming at all --
 * `sub` inherits the surface's full-contrast ink.
 *
 * `raised` sits on `--ground-raised`, a lighter fill than the `--ground` that
 * `--text-dim` is actually measured against -- it happens to still clear AA
 * there (4.52:1), but that is this surface's own number, not the token's
 * tested pairing carrying over. `ghost` is transparent, so `text-dim` is only
 * as safe as whatever is behind it: on `--ground` it holds: on an orange
 * field -- `--action` or `--action-quiet` -- it does not. text-dim on
 * `--action` measures 1.79:1 and on `--action-quiet` 3.46:1, both well under
 * the 4.5:1 floor. Never stack a `ghost` Plate over an orange background.
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
 * `label` never carries opacity: --on-action is measured at exactly 4.9:1 on
 * orange, and any opacity tint drops that below the 4.5:1 AA floor. `label`
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

  const base = [
    "flex min-h-[44px] w-full items-center gap-3 rounded-[6px] px-4 py-3",
    center ? "text-center justify-center" : "text-left",
    "transition-[transform,background-color] duration-150",
    "active:translate-y-[1px] disabled:opacity-50 disabled:pointer-events-none",
    SURFACE[variant],
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
          <span className={["mt-1 block text-[11px] leading-snug", SUB_TONE[variant]].join(" ")}>
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
      // Present only when true: most Plates are one-shot actions ("Copy join
      // link"), not toggles, and `aria-pressed="false"` on every one of them
      // would announce all of them as toggle buttons to a screen reader.
      aria-pressed={selected || undefined}
      className={base}
    >
      {inner}
    </button>
  );
}
