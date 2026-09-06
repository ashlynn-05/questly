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
 * `sub` inherits the surface's full-contrast ink. `raised` and `ghost` sit on
 * `--ground`, where `--text-dim` is measured and safe to use.
 */
const SUB_TONE: Record<Variant, string> = {
  action: "",
  quiet: "",
  raised: "text-dim",
  ghost: "text-dim",
};

type Props = {
  variant?: Variant;
  selected?: boolean;
  label: string;
  sub?: string;
  right?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  href?: string;
  onClick?: () => void;
  className?: string;
};

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
export function Plate({
  variant = "raised",
  selected = false,
  label,
  sub,
  right,
  icon,
  disabled = false,
  href,
  onClick,
  className = "",
}: Props) {
  const base = [
    "group flex min-h-[44px] w-full items-center gap-3 rounded-[6px] px-4 py-3",
    "text-left transition-[transform,background-color] duration-150",
    "active:translate-y-[1px] disabled:opacity-50 disabled:pointer-events-none",
    SURFACE[variant],
    selected ? "ring-2 ring-accent ring-offset-2 ring-offset-ground" : "",
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

  // A navigation control stays a link, so middle-click and open-in-new-tab work.
  if (href) {
    return (
      <Link href={href} className={base}>
        {inner}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} disabled={disabled} className={base}>
      {inner}
    </button>
  );
}
