import Link from "next/link";
import { ThemeToggle } from "@/components/questly/theme";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-[560px] flex-1 flex-col justify-center gap-10 bg-ground px-6 py-16">
      <div className="flex items-start justify-between">
        <p className="board text-[11px] text-accent">Melbourne</p>
        <ThemeToggle />
      </div>

      <div>
        <h1 className="display text-[64px] text-text">Questly</h1>
        <p className="mt-4 text-[19px] leading-snug text-dim">
          Turns &ldquo;we should catch up&rdquo; into a plan, in two taps.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <Link
          href="/start"
          className="board flex min-h-[52px] items-center justify-center rounded-[6px] bg-action text-[12px] text-on-action"
        >
          Start a quest
        </Link>
        {/* Standalone, not inline in a sentence, so it needs the same 44px
            target floor as every other tappable thing in this product -- the
            padding and min-width are what make the target, not the label. */}
        <Link
          href="/direction"
          className="flex min-h-[44px] min-w-[44px] w-fit items-center px-1 text-[13px] text-dim underline underline-offset-4"
        >
          Design reference
        </Link>
      </div>
    </main>
  );
}
