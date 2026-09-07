import type { ComponentProps } from "react";

/**
 * The three template controls, finally on this product's tokens.
 *
 * These are the only controls on `/sign-in` and `/sign-up` -- the one path a
 * signed-out visitor is forced down -- and they shipped in Create-Next-App's
 * neutral greys on a page whose body is `--ground-deep`. In dark mode, which is
 * the default, `text-neutral-900` (#171717) on `#1a1640` measured **1.05:1**:
 * every social sign-in button was invisible. `text-neutral-600` was 2.18:1, and
 * `border-neutral-300` was 1.09:1 against the same page's light-mode body
 * (`--ground-deep`, #f9dc5c). All three are gone.
 *
 * Everything here is measured against `--ground`, which is what the two auth
 * pages now paint themselves. `--text` is 10.20:1 on it in dark and 15.97:1 in
 * light; `--text-dim` is 5.26:1 / 6.21:1, which is why it is also the border --
 * `--hairline` is 1.44:1 / 1.39:1 and would be no boundary at all.
 */

/**
 * 16px is not a style choice: iOS Safari zooms the whole page when a field
 * under 16px takes focus, and these fields are filled one-handed. 44px is this
 * project's target floor, applied to controls as well as to targets.
 * `:focus-visible` in globals.css draws the focus ring, so no border swap here.
 */
export function Input(props: ComponentProps<"input">) {
  return (
    <input
      {...props}
      className={`min-h-[44px] w-full rounded-[5px] border border-dim bg-transparent px-3 text-[16px] text-text placeholder:text-dim ${props.className ?? ""}`}
    />
  );
}

/**
 * `primary` is the same orange field as `Plate variant="action"`, and carries
 * `--action-edge` for the same reason: the fill alone is 2.95:1 on the dark
 * ground, under SC 1.4.11's 3:1 for a control's boundary, and `--action` cannot
 * move because `--on-action` is exactly 4.92:1 on it. `secondary` is the ghost
 * treatment: full-contrast text inside a `--text-dim` boundary.
 *
 * Disabled is expressed by DROPPING the fill, never by opacity. Half-opacity on
 * an orange field takes the label from 4.92:1 to 2.17:1 in dark and 1.86:1 in
 * light -- see Plate.tsx, which states the rule this used to break.
 */
export function Button({
  variant = "primary",
  ...props
}: ComponentProps<"button"> & { variant?: "primary" | "secondary" }) {
  const enabled =
    variant === "primary"
      ? "bg-action text-on-action border border-action-edge"
      : "bg-transparent text-text border border-dim hover:bg-ground-raised";
  const surface = props.disabled
    ? "bg-transparent text-dim border border-dashed border-dim"
    : enabled;
  return (
    <button
      {...props}
      className={`board flex min-h-[44px] w-full items-center justify-center rounded-[5px] px-4 text-[11px] transition-colors disabled:pointer-events-none ${surface} ${props.className ?? ""}`}
    />
  );
}

/**
 * Always mounted, even with nothing in it.
 *
 * This used to `return null` when empty and carried no role at all, so a
 * rejected password and a rejected sign-up announced nothing whatsoever -- the
 * element did not exist until the moment its text did, which is the pattern
 * this codebase warns against in three other files. `empty:-mt-3` cancels the
 * flex gap its parent forms would otherwise leave around an empty paragraph;
 * `display: none` is not an option, because a hidden region is out of the
 * accessibility tree and would be no better than not being here.
 *
 * The text is better-auth's own message, not a `ConvexError` -- so the
 * stringified-data trap `userMessage` exists for does not apply here.
 */
export function ErrorText({ children }: { children?: string | null }) {
  return (
    <p role="alert" className="rounded-[5px] text-[13px] leading-snug text-danger empty:-mt-3">
      {children ?? ""}
    </p>
  );
}
