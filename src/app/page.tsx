import Link from "next/link";
import { api } from "@convex/_generated/api";
import { fetchAuthQuery } from "@/lib/auth-server";
import { Screen } from "@/components/questly/Screen";
import { Rail, RailEnd, RailNode } from "@/components/questly/Rail";
import { InstallHint } from "@/components/questly/InstallHint";

/**
 * Whether this visitor already has an account, read on the server.
 *
 * The landing page used to say the same thing to everybody, which meant a
 * signed-in person had no sign anywhere in the product that they were signed in
 * -- and no route to the account screen, because until now there was no account
 * screen to route to.
 *
 * Read here rather than in a client island so there is no signed-out flash and
 * no second round trip; `fetchAuthQuery` has been exported from
 * `src/lib/auth-server.ts` since the auth wiring landed and this is its first
 * caller. The cost is that this page is no longer statically rendered, which is
 * the honest price of it saying something true about the person reading it.
 *
 * Failure is not fatal. If the auth read throws -- a cold deployment, a network
 * blip -- the landing page still has to render, because it is the front door.
 * Signed-out is the right thing to show when we cannot tell: the worst it costs
 * a signed-in visitor is one extra tap through a sign-in page that will
 * recognise them immediately.
 */
async function currentUser() {
  try {
    return await fetchAuthQuery(api.auth.getCurrentUser, {});
  } catch {
    return null;
  }
}

export default async function Home() {
  const user = await currentUser();

  return (
    <Screen>
      {/* The route line, on the front door.
         
          The landing page carried none of the product's own vocabulary before
          this: a headline, two dim paragraphs and a button, structurally
          interchangeable with any product's front page. DESIGN.md's north star
          is one orange line with roundel stops, and this surface's brief opens
          its first viewport with that line -- so the front door is the first
          stop on it.

          Dashed, because nothing is decided yet: the line ahead of a night that
          has not been planned is exactly the state `rail-dashed` was drawn for.
          Two stops and no more -- where you are, and the one thing to do next.
          A third would be inventing a journey the page does not have. */}
      <div className="relative flex flex-col gap-8">
        <Rail dashed />

        <div className="relative pl-14">
          {/* Live: this is where the visitor is standing. 4px puts the
              roundel's centre (top + 9.5, for a 13px disc in a 3px ring) on the
              cap height of the first display line. */}
          <RailNode top={4} state="live" />
          {/* The proposition, at display scale, rather than the product name --
              the band above now carries the name, and spending the largest type
              in the product on a word the header already says is the definition
              of saying nothing twice. `.display` balances its own wrapping, so
              this never orphans a word on its own line. */}
          <h1 className="display text-[34px] text-text">
            Turns &ldquo;we should catch up&rdquo; into a plan, in two taps.
          </h1>
        </div>

        <div className="relative flex flex-col gap-3 pl-14">
          {/* The line ends here rather than running to the bottom of whatever
              this column grows to -- the last stop is the end of the route.
              BEFORE the node, not after: the cap is a 5px stripe of `--ground`
              painted from the roundel's centre down, and drawn afterwards it
              takes a bite out of the bottom of a hollow roundel's ring. */}
          <RailEnd top={26} />
          {/* Open: the next stop, not yet taken. 16px centres the roundel on
              the 52px plate beside it. */}
          <RailNode top={16} state="open" />
          {/* Same orange field as a `Plate` with variant="action", and it takes
              the same edge for the same reason: the fill alone is 2.95:1 on the
              dark ground, under SC 1.4.11's 3:1 for a control's boundary. */}
          <Link
            href="/start"
            className="board flex min-h-[52px] items-center justify-center rounded-[6px] border border-action-edge bg-action text-[12px] text-on-action"
          >
            Start a quest
          </Link>
          {/* Under the button, not above it. It qualifies the action -- which
              account is about to own this quest -- and read as a third dim
              paragraph between the headline and the button it was one more
              thing to get past on the way to the only control that matters.
              Shown only when there is a name: on a shared laptop, which account
              this browser is holding is a real question, and the roundel in the
              band answers it with a picture alone. */}
          {user ? (
            <p className="text-[13px] leading-snug text-dim">
              Signed in as <span className="text-text">{user.name ?? user.email}</span>.
            </p>
          ) : null}
        </div>
      </div>

      {/* Off the line and last, because it goes out of the product: this is the
          design reference, not a step in anyone's night. Standalone rather than
          inline in a sentence, so it takes the same 44px target floor as every
          other tappable thing here -- the padding and min-width are what make
          the target, not the label. */}
      <Link
        href="/direction"
        className="flex min-h-[44px] min-w-[44px] w-fit items-center px-1 text-[13px] text-dim underline underline-offset-4"
      >
        Design reference
      </Link>

      {/* A closed `<dialog>`, so its position in the flow is not its position
          on screen -- it opens centred over the page. Opens for nobody but an
          iOS Safari visitor who has not installed Questly and has not already
          dismissed it. */}
      <InstallHint />
    </Screen>
  );
}
