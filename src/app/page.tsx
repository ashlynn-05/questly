import Link from "next/link";
import { InstallHint } from "@/components/questly/InstallHint";
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
        {/* Same orange field as a `Plate` with variant="action", and it takes
            the same edge for the same reason: the fill alone is 2.95:1 on the
            dark ground, under SC 1.4.11's 3:1 for a control's boundary. */}
        <Link
          href="/start"
          className="board flex min-h-[52px] items-center justify-center rounded-[6px] border border-action-edge bg-action text-[12px] text-on-action"
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

      {/* A closed `<dialog>`, so its position in the flow is not its position
          on screen -- it opens centred over the page. Opens for nobody but an
          iOS Safari visitor who has not installed Questly and has not already
          dismissed it. */}
      <InstallHint />
    </main>
  );
}
