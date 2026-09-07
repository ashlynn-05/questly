import { Plate } from "@/components/questly/Plate";

/**
 * The one document `public/sw.js` caches, shown when a navigation fails with no
 * network. Everything in Questly is a live Convex subscription, so this page
 * cannot pretend to be the app -- it says what is actually wrong and offers the
 * only move that helps, which is trying again once there is signal.
 *
 * Written to survive with NO JavaScript: it is served out of the cache, and the
 * route's JS chunks are not in that cache, so nothing here hydrates. Links
 * still navigate because they are anchors, and the page is still in the right
 * colour mode because the pre-paint script in the layout is inline. That is
 * also why there is no `ThemeToggle` here -- a switch that cannot switch is
 * worse than no switch.
 */
export default function Offline() {
  return (
    <main className="mx-auto flex w-full max-w-[520px] flex-1 flex-col justify-center gap-6 bg-ground px-5 py-10">
      <p className="board text-[11px] text-accent">Questly</p>

      {/* The line's own language: a stop you cannot reach yet, not an error code. */}
      <h1 className="display text-[38px] text-text">The line is down</h1>

      <p className="text-[15px] leading-relaxed text-dim">
        Your phone has no connection right now. Questly needs one — the room, the deck and the plan
        are live, and everyone else in the group is changing them while you read this. Nothing you
        have done is lost; the room is on the server, waiting.
      </p>

      <Plate variant="action" href="/start" label="Try again" center />
    </main>
  );
}
