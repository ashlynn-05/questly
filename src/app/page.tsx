import Link from "next/link";
import { api } from "@convex/_generated/api";
import { fetchAuthQuery } from "@/lib/account/auth-server";
import { ThemeToggle } from "@/components/questly/theme";
import { InstallHint } from "@/components/questly/InstallHint";
import { StandaloneRedirect } from "./_components/landing/StandaloneRedirect";
import { FlipOnView } from "./_components/landing/FlipOnView";
import { Reveal } from "./_components/landing/Reveal";
import { Cycler } from "./_components/landing/Cycler";
import { ThemeImage } from "@/components/questly/ThemeImage";
import { ReasonsRail } from "./_components/landing/ReasonsRail";
import { RouteBand } from "./_components/landing/RouteBand";
import { People } from "./_components/landing/People";
import { HeroField } from "./_components/landing/HeroField";
import { Activities } from "./_components/landing/Activities";
import { Venues } from "./_components/landing/Venues";
import { Fan } from "./_components/landing/Fan";

/**
 * The direction this page is held to, in the emitted markup so it can be
 * audited against the render rather than against anybody's memory of it.
 *
 * A JSX comment would not do: the compiler strips those, and a contract the
 * build erases is a contract nobody can check. This is an HTML comment inside a
 * hidden element, which is the only way an App Router page can put one in the
 * document without owning the `<body>`.
 */
const DIRECTION = `<!--
THESIS: A night out is a decision nobody wants to make, so this page shows the
decision already made -- a place, a time, a price per head -- and says who made
it.

OWN WORLD: The Network. Melbourne transit wayfinding, as committed in
globals.css and DESIGN.md. The PAGE ground is --ground-deep and the panels on
it are --ground, which is the figure/ground relationship the comp is built on:
ink at night, naples yellow by day, with iris / cornsilk cards sitting on top.

STORY: the hero states the detour; the fan shows the product running; three
reasons say why it works; the six-stop journey is the route; the activities and
the departures board are the destinations; then the price, which is nothing.

FIRST VIEWPORT: eyebrow, headline, one sentence, one orange action, and the top
of the phone. Nothing else.

FORM: one column on a phone, the fan and the six-stop band only where there is
room for them. WCAG 2.2 AA, and no moving thing that cannot be stopped.

CUT FROM THE COMP, and why: testimonials, the Melbourne venue marquee, and the
App Store / Google Play badges. PRODUCT.md forbids invented people, named
venues presented as partners, and claims about software that does not exist.
The forever-cycling headline is cut too -- SC 2.2.2 wants a pause control for
anything that moves by itself and never stops. It flips once and settles.
-->`;

/** The comp's three reasons, verbatim. */
const REASONS = [
  {
    mark: "Reason 01 · AI",
    title: "AI does the deciding.",
    body: "It reads your eight answers and the room’s constraints, then shortlists real places that fit everyone at once.",
  },
  {
    mark: "Reason 02",
    title: "One plan, not forty messages.",
    body: "The chat ends with a place, a time and a price per head. No polls, no maybes.",
  },
  {
    mark: "Reason 03",
    title: "Broke nights still count.",
    body: "$0 quests sit next to the $40 ones, not below them. A creek loop at 6:15 is a real night out.",
  },
];

/** The six stops, verbatim from the comp. */
const STOPS = [
  {
    mark: "Step 01",
    title: "Getting to know you",
    body: "Eight questions at sign-up. Asked once.",
  },
  {
    mark: "Step 02",
    title: "What kind of activity",
    body: "Three kinds of night. Pick one.",
  },
  {
    mark: "Step 03",
    title: "Who is coming",
    body: "Yourself, or people — strangers or friends.",
  },
  {
    mark: "Step 04",
    title: "Put in a room",
    body: "People, locations, budget, time, distance.",
  },
  { mark: "Step 05", title: "Swipe", body: "Everyone swipes the same deck." },
  {
    mark: "Terminus",
    title: "Plan",
    body: "A place, a time, a price per head.",
  },
];

const ACTIVITIES = [
  {
    mark: "Activity 01",
    title: "Touch grass",
    body: "A natural hangout. The creek loop at 6:15, a park, a swim. Outside, usually $0.",
  },
  {
    mark: "Activity 02",
    title: "Random crazy sidequests",
    body: "Visit an old school fairy tale theme park. The ones you would never book alone.",
  },
  {
    mark: "Activity 03",
    title: "Hang-outs",
    body: "A girly hangout in the city. Food, a walk, somewhere to sit and talk.",
  },
];

/**
 * Demonstration data, and the $0 row sits level with the $24 one rather than
 * under it -- Product Principle 3 made visible instead of claimed, which is why
 * the board is sorted by time and not by price. The caption above it says so in
 * words a sighted visitor can read: a headcount that looks live is exactly the
 * fabricated number PRODUCT.md forbids.
 */
const BOARD = [
  {
    time: "6:15",
    quest: "Merri Creek loop",
    kind: "Touch grass",
    head: "$0",
    heads: "4",
  },
  {
    time: "7:30",
    quest: "Fairy tale theme park",
    kind: "Sidequest",
    head: "$24",
    heads: "3",
  },
  {
    time: "8:00",
    quest: "Rooftop night market",
    kind: "Hang-out",
    head: "$12",
    heads: "6",
  },
];

/**
 * The comp's action plate: 58px tall, 12px radius, with the inset highlight its
 * store badges carried. `--action-edge` rather than an orange border -- orange
 * on either ground is under SC 1.4.11's 3:1 and the fill has no headroom to
 * move, so the edge is what does the work.
 */
const CTA =
  "board inline-flex min-h-[58px] items-center justify-center rounded-[12px] border border-action-edge bg-action px-8 text-[13px] text-on-action transition-transform duration-200 hover:-translate-y-[2px] active:translate-y-[1px]";
/** The same plate, unfilled: a `--ground` panel on the `--ground-deep` page. */
const CTA_QUIET =
  "board inline-flex min-h-[58px] items-center justify-center rounded-[12px] border border-hairline bg-ground px-8 text-[13px] text-text transition-colors duration-200 hover:border-dim";
/** The comp's 60px section heading, given a floor so it survives a phone. */
const H2 = "display text-center text-[clamp(30px,5.4vw,60px)] text-text";
/**
 * The board's five columns, at the comp's widths. A `<table>` sizes itself to
 * its content without these, and "Merri Creek loop" then takes half the board
 * while the four figure columns crush together.
 */
const COLS = {
  Time: "w-[64px] lg:w-[90px]",
  Quest: "",
  Kind: "hidden lg:table-cell lg:w-[130px]",
  "Per head": "w-[84px] lg:w-[110px]",
  Heads: "w-[64px] lg:w-[110px]",
} as const;

/** The page's horizontal rhythm: the comp's 72px, down to 20px on a phone. */
const PAD = "px-5 lg:px-10 xl:px-[72px]";

/**
 * The signed-in line needs the session, and an unreachable Convex deployment
 * must not take the front door down with it. A landing page that 500s because
 * the backend is asleep is worse than one that greets everybody the same way.
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
    /* THE GROUND INVERSION, and the reason this route does not use `Screen`.
       `Screen` paints `--ground` and caps its measure at 1120px, which is the
       product's shell: right for a room, wrong for a front door. The comp puts
       the PAGE on `--ground-deep` and floats `--ground` panels on it, and the
       fan alone needs ~1100px of bleed. So `/` carries its own shell -- and
       carries the wordmark in it, which is the one rule `Screen` states about
       every route without exception. */
    <div className="flex min-h-dvh flex-col bg-ground-deep text-text">
      <div hidden dangerouslySetInnerHTML={{ __html: DIRECTION }} />
      {/* Renders nothing on the web. Inside the installed app this page is a
          detour on the way to `/start`, so it does not get shown. */}
      <StandaloneRedirect />

      {/* The comp's nav: 76px, the wordmark left, everything else right. The
          three links go to sections that exist on this page -- the comp's
          "Rooms" and "About" point at routes that do not. */}
      {/* No rule under it. The design draws one in #1a1640, which IS the ink
          the band is painted in -- invisible by night, and the only reason it
          appeared here at all was `--hairline`, which on `--ground-deep` reads
          as a stray purple line across the top of the page. */}
      <header
        className={`sticky top-0 z-30 flex h-[76px] shrink-0 items-center justify-between gap-3 bg-ground-deep ${PAD}`}
      >
        {/* The drawn wordmark, not the word set in type: this is the one place
            on the product where the mark itself is the sign. 40px tall, the
            design's own height, in both of its colourways. */}
        <Link
          href="/"
          aria-label="Questly, home"
          className="flex min-h-[44px] items-center px-1"
        >
          <ThemeImage
            night="/brand/questly-mark-night.png"
            day="/brand/questly-mark-day.png"
            alt="Questly"
            width={113}
            height={40}
            priority
            className="h-10 w-auto"
          />
        </Link>
        <nav aria-label="This page" className="flex items-center gap-5">
          <a
            href="#how"
            className="hidden min-h-[44px] items-center text-[13px] text-text hover:text-accent lg:flex"
          >
            How it works
          </a>
          <a
            href="#activities"
            className="hidden min-h-[44px] items-center text-[13px] text-dim hover:text-accent lg:flex"
          >
            Activities
          </a>
          <a
            href="#price"
            className="hidden min-h-[44px] items-center text-[13px] text-dim hover:text-accent lg:flex"
          >
            Price
          </a>
          <ThemeToggle />
          <Link
            href="/start"
            className="board inline-flex min-h-[44px] items-center rounded-[6px] border border-action-edge bg-action px-4 text-[11px] text-on-action"
          >
            Start a quest
          </Link>
        </nav>
      </header>

      <main className="flex-1">
        {/* --- The hero ---------------------------------------------------
            Centred, as the comp has it. Both washes are `inset-x-0` rather
            than the comp's fixed 1100px box: `closest-side` inside a box wider
            than the column is all centre and no falloff, which on a phone
            painted a grey slab with hard vertical edges. The rail mix is 15%
            and not the comp's 30% because the eyebrow and the subhead sit on
            top of it, and at 30% the eyebrow measured under AA. */}
        <section
          className={`relative overflow-hidden pt-14 pb-16 text-center lg:pt-[88px] ${PAD}`}
        >
          <HeroField />

          {/* The design's own arrival sequence: the eyebrow, then the subhead
              at 130ms, then the buttons at 210ms, then the fan. It is the only
              motion on this page that is not answering a scroll, and it is here
              because the first screen had none at all -- everything that moved
              was below the fold, which is a page that reads as a picture until
              you have already decided to leave. */}
          <Reveal>
            <p className="board relative m-0 mb-[22px] text-[11px] text-accent">
              Melbourne · tonight
            </p>
          </Reveal>
          {/* Both of the design's lines, alternating on the board flap. The
              heading keeps ONE accessible name for the life of the page --
              see `Cycler` for why that is the whole accessibility story here. */}
          <h1 className="display relative m-0 text-[clamp(34px,7vw,82px)] leading-[1.05]">
            <Cycler lines={["Make a little detour.", "Plans? Questly."]} />
          </h1>
          <Reveal delay={130}>
            <p className="relative mx-auto mt-[26px] max-w-[52ch] text-[17px] leading-[1.5] text-dim">
              <strong className="block font-semibold text-text">
                Turning “we should catch up” into one specific, bookable plan
              </strong>
              with places, a specific time, a price per head.
              <br />
              AI proposes, so nobody has to.
            </p>
          </Reveal>

          {/* The comp's two store badges, replaced by the two things that are
              true: the product runs here, and the page explains itself lower
              down. No App Store badge for an app that does not exist. */}
          <Reveal delay={210}>
            <div className="relative mt-[30px] flex flex-wrap justify-center gap-3">
              <Link
                href="/start"
                className={CTA}
                style={{
                  boxShadow:
                    "inset 0 1px 0 color-mix(in oklab, var(--action-edge) 30%, transparent)",
                }}
              >
                Start a quest
              </Link>
              <a href="#how" className={CTA_QUIET}>
                See how it works
              </a>
            </div>
            <p className="relative mt-4 text-[13px] text-dim">
              {user
                ? "You are signed in. Picking up where you left off."
                : "Free, and no app to install."}
            </p>
          </Reveal>

          <Reveal delay={280}>
            <Fan />
          </Reveal>
        </section>

        {/* --- Three reasons ----------------------------------------------
            The `--ground` panel the comp floats on its `--ground-deep` page,
            fading back into it at the bottom. The comp scroll-pins this for
            1000px and reveals one row at a time; that is a scrolljack, so all
            three are here at once on the rail.

            The rail is drawn inline rather than with `Rail`/`RailNode`:
            `.node` and `.rail-end` mask themselves with `--ground`, and on a
            panel that fades they would leave iris dots behind. */}
        <section className="relative">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 bottom-0"
            style={{
              background:
                "linear-gradient(180deg, var(--ground) 0%, var(--ground) 84%, color-mix(in oklab, var(--ground) 40%, var(--ground-deep)) 93%, var(--ground-deep) 100%)",
            }}
          />
          <div className={`relative pt-16 pb-24 ${PAD}`}>
            <Reveal>
              <p className="board m-0 mb-[10px] text-center text-[10px] text-accent">
                Why Questly?
              </p>
              <h2 className={`${H2} m-0 mb-11`}>
                <FlipOnView>Three reasons it works.</FlipOnView>
              </h2>
            </Reveal>

            <ReasonsRail reasons={REASONS} />
          </div>
        </section>

        {/* --- The journey ------------------------------------------------ */}
        <section
          id="how"
          className={`scroll-mt-[76px] pt-24 pb-8 text-center ${PAD}`}
        >
          <Reveal>
            <h2
              className={`${H2} m-0 mb-[10px] forced-colors:!bg-none forced-colors:!text-text`}
              style={{
                backgroundImage:
                  "linear-gradient(100deg, var(--text) 30%, var(--accent))",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              No worries, plans on Questly.
            </h2>
            <p className="m-0 mx-auto max-w-[56ch] text-[16px] leading-[1.5] text-dim">
              Eight questions to learn how you like to spend a night, then a
              room, a swipe and a plan. You answer; we propose.
            </p>
          </Reveal>
        </section>

        <div className={`relative pb-4 ${PAD}`}>
          {/* The six stops, their route line and its scroll behaviour. */}
          <RouteBand stops={STOPS} />
        </div>

        {/* --- The three activities --------------------------------------- */}
        <section
          id="activities"
          className={`scroll-mt-[76px] pt-[72px] ${PAD}`}
        >
          <h2 className="sr-only">Three kinds of night</h2>
          <Activities activities={ACTIVITIES} />
        </section>

        {/* --- The departures board ---------------------------------------
            A real `<table>`, not the comp's grid of spans: five columns of
            figures with headers is a table, and a screen reader should be
            able to say which column a cell is in. */}
        <section className={`pt-20 pb-26 ${PAD}`}>
          <Reveal>
            <div
              className="overflow-hidden rounded-[6px] border"
              style={{
                borderColor:
                  "color-mix(in oklab, var(--rail) 45%, transparent)",
                backgroundImage:
                  "linear-gradient(160deg, color-mix(in oklab, var(--rail) 12%, var(--ground)) 0%, var(--ground) 55%, var(--ground-deep) 100%)",
              }}
            >
              <table className="w-full table-fixed border-collapse text-left">
                {/* Visible, not `sr-only`. The one word that keeps this board
                  from reading as three live quests with three real headcounts
                  has to reach the visitor who can see it. */}
                <caption className="board px-5 pt-4 pb-1 text-left text-[10px] text-accent">
                  Example quests · demonstration data
                </caption>
                <thead>
                  <tr>
                    {(Object.keys(COLS) as (keyof typeof COLS)[]).map(
                      (label) => (
                        <th
                          key={label}
                          scope="col"
                          className={`board border-b border-hairline px-5 py-[14px] text-[10px] font-normal text-accent ${COLS[label]}`}
                        >
                          {label}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {BOARD.map((row, i) => (
                    <tr key={row.quest}>
                      <td className="border-b border-hairline px-5 py-[18px] align-middle">
                        <FlipOnView delay={i * 120} className="num text-[15px]">
                          {row.time}
                        </FlipOnView>
                      </td>
                      <td className="border-b border-hairline px-5 py-[18px] align-middle">
                        <FlipOnView
                          delay={i * 120 + 30}
                          className="display text-[17px]"
                        >
                          {row.quest}
                        </FlipOnView>
                        <span className="board mt-1 block text-[10px] text-dim lg:hidden">
                          {row.kind}
                        </span>
                      </td>
                      <td className="board hidden border-b border-hairline px-5 py-[18px] align-middle text-[10px] text-dim lg:table-cell">
                        {row.kind}
                      </td>
                      <td className="border-b border-hairline px-5 py-[18px] align-middle">
                        <FlipOnView
                          delay={i * 120 + 60}
                          className="num text-[20px] text-accent"
                        >
                          {row.head}
                        </FlipOnView>
                      </td>
                      <td className="border-b border-hairline px-5 py-[18px] align-middle">
                        <FlipOnView
                          delay={i * 120 + 90}
                          className="num text-[20px] text-dim"
                        >
                          {row.heads}
                        </FlipOnView>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Reveal>
        </section>

        {/* --- Who this is for --------------------------------------------
            The design heads this block "What our customers said?". That claim
            cannot ship -- PRODUCT.md forbids testimonials outright and this
            build has no customers -- but what it DREW under that heading is
            three personas with a badge, a situation and a line of their own
            speech. So the artwork stays and the claim goes. See `People`. */}
        <section className={`pb-26 ${PAD}`}>
          <Reveal>
            <h2 className={`${H2} m-0 mt-10 mb-[26px]`}>
              <FlipOnView>Who this is for.</FlipOnView>
            </h2>
          </Reveal>
          <Reveal>
            <People />
          </Reveal>
        </section>

        {/* --- Venues we would launch with --------------------------------
            Aspirational, and it says so. See `Venues` for the line that keeps
            this the right side of "no named partner venues". */}
        <section className={`pb-26 ${PAD}`}>
          <Reveal>
            <p className="board m-0 mb-4 text-[10px] text-dim">
              Melbourne venues we would launch with
            </p>
            <Venues />
          </Reveal>
        </section>

        {/* --- What it costs ----------------------------------------------
            The acceptance criterion the comp never covers, in the space its
            testimonials and venue marquee used to take. */}
        <section
          id="price"
          className={`scroll-mt-[76px] pb-24 text-center ${PAD}`}
        >
          <Reveal>
            <h2 className={`${H2} m-0 mb-4`}>
              <FlipOnView>You pay nothing.</FlipOnView>
            </h2>
            <p className="m-0 mx-auto max-w-[54ch] text-[16px] leading-[1.6] text-dim">
              Venues pay when a booking fills. You answer eight questions, open
              a room and swipe. In this build nothing is charged and no booking
              is real.
            </p>
          </Reveal>
        </section>

        {/* --- The sign-off ----------------------------------------------- */}
        <section
          className={`relative overflow-hidden pt-4 pb-[120px] text-center ${PAD}`}
        >
          {/* The glow arrives with the line rather than being already there.
              `Reveal` takes the absolute box itself, because a wrapper around
              an absolutely-positioned child would be a static div and the wash
              would drop into the flow. */}
          <Reveal className="pointer-events-none absolute inset-x-0 -top-20 -bottom-10">
            <span
              aria-hidden="true"
              className="block h-full w-full"
              style={{
                background:
                  "radial-gradient(115% 78% at 50% 112%, color-mix(in oklab, var(--accent) 34%, transparent) 0%, color-mix(in oklab, var(--action) 26%, transparent) 26%, color-mix(in oklab, var(--action) 11%, transparent) 52%, color-mix(in oklab, var(--rail) 5%, transparent) 74%, transparent 100%)",
              }}
            />
          </Reveal>
          <h2 className="display relative m-0 mt-12 mb-6 text-[clamp(38px,7vw,76px)]">
            <FlipOnView>
              sidequests. <span className="text-accent">together.</span>
            </FlipOnView>
          </h2>
          <div className="relative flex justify-center">
            <Link
              href="/start"
              className={CTA}
              style={{
                boxShadow:
                  "inset 0 1px 0 color-mix(in oklab, var(--action-edge) 30%, transparent)",
              }}
            >
              Start a quest
            </Link>
          </div>
        </section>
      </main>

      <footer
        className={`flex flex-wrap items-center justify-between gap-4 border-t border-hairline py-[26px] ${PAD}`}
      >
        {/* Privacy / Terms / Contact are dropped: those routes do not exist.
            Neither does a link to `/direction` -- the internal design reference
            is not something a visitor to the front door is being offered. */}
        <ThemeImage
          night="/brand/questly-mark-night.png"
          day="/brand/questly-mark-day.png"
          alt="Questly"
          width={73}
          height={26}
          className="h-[26px] w-auto"
        />
        <p className="m-0 text-[12px] text-dim">
          Bookings in this build are simulated.
        </p>
      </footer>

      <InstallHint />
    </div>
  );
}
