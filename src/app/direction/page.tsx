"use client";

import { useState } from "react";
import { Phone, MapTile } from "@/components/questly/frame";
import { People, Coin, Clock, Pin, Check, Cross, Lock, Swap, Hand } from "@/components/questly/icons";
import { ThemeToggle } from "@/components/questly/theme";
import { Plate } from "@/components/questly/Plate";
import { Chip } from "@/components/questly/Chip";
import { Rail, RailNode } from "@/components/questly/Rail";

/* Demonstration content. Public places are named as themselves; anything
   badged as a partner is invented and labelled as such on the page. */

const MOODS = [
  { key: "grass", title: "Touch grass", sub: "Outside, moving, free" },
  { key: "meet", title: "Meet people", sub: "Rooms with strangers in them" },
  { key: "treat", title: "Treat yourself", sub: "Spend it on something good" },
  { key: "new", title: "Do something new", sub: "You have not done this before" },
];

const BOARD = ["Sifting the deck", "Ranking on budget", "Princes Park"];

export default function DirectionPage() {
  return (
    <main className="min-h-screen bg-ground-deep px-6 py-14 lg:px-14">
      <Header />
      <Foundations />

      <section className="mt-20">
        <h2 className="display text-[clamp(2rem,5vw,3.4rem)]">The line, end to end</h2>
        <p className="mt-4 max-w-[62ch] text-[15px] leading-relaxed text-dim">
          Seven stops. The orange line is the same line on every screen — it is how you
          know you are still in the same night. Nothing here is a card grid, because a
          route is not a grid.
        </p>
        <div className="mt-10 flex gap-7 overflow-x-auto pb-8">
          <Phone label="Stop 01 · Mood" note="Four plates, not a dropdown. Mood decides which venues are even queried.">
            <MoodScreen />
          </Phone>
          <Phone label="Stop 02 · Constraints" note="Four inputs, each a plate you tap. $0 sits first in the budget row, not last.">
            <PlanningScreen />
          </Phone>
          <Phone label="Stop 03 · The room" note="Guests board with a first name. No account, no quiz — that is what keeps a live demo alive.">
            <RoomScreen />
          </Phone>
          <Phone label="Stop 04 · The deck" note="One shared deck, everyone swiping at once. Buttons carry the same weight as the swipe.">
            <DeckScreen />
          </Phone>
          <Phone label="Stop 05 · The match" note="The authored moment. Every board flips and lands on the same destination at the same instant.">
            <MatchScreen />
          </Phone>
          <Phone label="Stop 06 · The plan" note="Three stops on the line. Lock what works, swap what does not, propose to the room.">
            <PlanScreen />
          </Phone>
          <Phone label="Stop 07 · Booked" note="Reference as a tabular figure, then out to the venue. Simulated, and it says so.">
            <BookedScreen />
          </Phone>
        </div>
      </section>

      <Notes />
    </main>
  );
}

/* ------------------------------------------------------------------ header */

function Header() {
  return (
    <header className="border-b border-hairline pb-12">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <h1 className="display text-[clamp(3rem,11vw,8rem)]">Questly</h1>
        <ThemeToggle />
      </div>
      <p className="mt-6 max-w-[58ch] text-[17px] leading-relaxed text-dim">
        A night out is a route with stops, not a feed to browse. The interface is
        Melbourne wayfinding: one orange line, roundel stops, indicator plates that
        flip instead of fade. It runs iris at night and yellow by day &mdash; flip the
        switch and every screen below follows.
      </p>
    </header>
  );
}

/* ------------------------------------------------------- colour + type spec */

const ROLES = [
  {
    name: "Ground",
    night: "#3b3686",
    day: "#fdf8e1",
    ratio: "10.2 / 16.0",
    use: "The surface, drenched. Iris after dark, cornsilk by day.",
  },
  {
    name: "Text",
    night: "#ffffff",
    day: "#1a1640",
    ratio: "10.2 / 16.0",
    use: "White on iris, ink on cornsilk. The ink is derived — neither palette shipped a dark.",
  },
  {
    name: "Dim",
    night: "#b9b6e0",
    day: "#5b5499",
    ratio: "5.3 / 6.2",
    use: "Tinted from the ground's own hue. Never gray.",
  },
  {
    name: "Accent",
    night: "#edba40",
    day: "#3b3686",
    ratio: "5.7 / 9.6",
    use: "The role that swaps. Apricot is 1.8:1 on cornsilk, so iris takes the job by day.",
  },
  {
    name: "Action",
    night: "#e0652b",
    day: "#e0652b",
    ratio: "4.9 / 4.9",
    use: "Field only, both modes. Orange text fails on iris (2.9:1) and on cornsilk (3.5:1).",
  },
  {
    name: "Rail",
    night: "#767ae6",
    day: "#767ae6",
    ratio: "2.8 / 3.5",
    use: "Map line work only. Fails non-text at night, so it never carries meaning alone.",
  },
];

function Foundations() {
  return (
    <section className="mt-16 grid gap-14 lg:grid-cols-[1.1fr_1fr]">
      <div>
        <h2 className="display text-[clamp(1.7rem,4vw,2.6rem)]">Archivo, both axes</h2>
        <p className="mt-4 max-w-[58ch] text-[15px] leading-relaxed text-dim">
          One superfamily doing two jobs. Display sits at the top of the width axis
          (wdth&nbsp;125) because signage wants width, not just weight. Text sits at
          normal width. Every figure is tabular — in this product every number is a
          price, a time, a headcount or a distance.
        </p>

        <div className="mt-8 space-y-6 border-t border-hairline pt-8">
          <div>
            <p className="board text-[10px] text-accent">Display · wdth 125 · wght 700</p>
            <p className="display mt-2 text-[clamp(2.2rem,6vw,3.6rem)]">Princes Park</p>
          </div>
          <div>
            <p className="board text-[10px] text-accent">Board · wdth 112 · uppercase · +0.14em</p>
            <p className="board mt-2 text-[13px]">Now boarding · 4 of 4 in</p>
          </div>
          <div>
            <p className="board text-[10px] text-accent">Figures · tabular</p>
            <p className="num mt-2 text-[clamp(2rem,5vw,3rem)]">$0 · 6:30 · 2.4km</p>
          </div>
          <div>
            <p className="board text-[10px] text-accent">Text · wdth 100 · wght 400</p>
            <p className="mt-2 max-w-[46ch] text-[15px] leading-relaxed">
              Lap the Tan while it is still light, then a bench and whatever you carried
              in. Costs nothing and nobody has to book it.
            </p>
          </div>
        </div>
      </div>

      <div>
        <h2 className="display text-[clamp(1.7rem,4vw,2.6rem)]">Six roles, two modes</h2>
        <p className="mt-4 max-w-[52ch] text-[15px] leading-relaxed text-dim">
          Both palettes are fixed. What is not obvious is that most of those colours
          cannot legally carry text, and AA is a requirement here — so every colour is
          pinned to a role and a measured ratio rather than used by eye. Ratios read
          night&nbsp;/&nbsp;day.
        </p>
        <div className="mt-8 border-t border-hairline pt-8">
          <div className="flex gap-2">
            <span className="board w-[74px] text-[9px] text-dim">Night</span>
            <span className="board w-[74px] text-[9px] text-dim">Day</span>
          </div>
          <ul className="mt-2 space-y-2">
            {ROLES.map((r) => (
              <li key={r.name} className="flex items-stretch gap-2">
                <span
                  className="w-[74px] shrink-0 border border-hairline"
                  style={{ background: r.night }}
                />
                <span
                  className="w-[74px] shrink-0 border border-hairline"
                  style={{ background: r.day }}
                />
                <div className="min-w-0 py-1 pl-2">
                  <p className="board text-[10px]">
                    {r.name}{" "}
                    <span className="num text-accent">{r.ratio}</span>
                  </p>
                  <p className="mt-1 text-[13px] leading-snug text-dim">{r.use}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ screens */

function ScreenChrome({ children, live }: { children: React.ReactNode; live?: string }) {
  return (
    <div className="relative h-full">
      <div className="flex items-center justify-between px-5 pt-5">
        <p className="board text-[9px] text-dim">Questly</p>
        {live && <p className="board text-[9px] text-accent">{live}</p>}
      </div>
      {children}
    </div>
  );
}

function MoodScreen() {
  return (
    <ScreenChrome>
      <div className="px-5 pt-7">
        <h3 className="display text-[34px]">What kind of night?</h3>
      </div>
      <div className="relative mt-7 h-[470px]">
        <span className="rail rail-dashed" style={{ top: 0, bottom: 40 }} />
        {MOODS.map((m, i) => (
          <div key={m.key} className="absolute left-0 right-5" style={{ top: i * 104 }}>
            <RailNode top={30} state={i === 0 ? "locked" : "open"} />
            <button
              className="ml-[52px] block w-full text-left transition-colors"
              style={{
                background: i === 0 ? "var(--action)" : "var(--ground-raised)",
                color: i === 0 ? "var(--on-action)" : "var(--text)",
                padding: "14px 16px",
              }}
            >
              <span className="display block text-[22px]">{m.title}</span>
              <span
                className="mt-1 block text-[12px]"
                style={{ color: i === 0 ? "var(--on-action)" : "var(--text-dim)" }}
              >
                {m.sub}
              </span>
            </button>
          </div>
        ))}
      </div>
    </ScreenChrome>
  );
}

const CHIPS = [
  { icon: People, label: "Who", value: "4 of us", options: ["Just me", "2", "3", "4", "5", "6+"] },
  { icon: Coin, label: "Each", value: "$0", options: ["$0", "$20", "$30", "$50", "$80"] },
  { icon: Clock, label: "When", value: "Tonight", options: ["Tonight", "Tomorrow", "Weekend"] },
  { icon: Pin, label: "Where", value: "Carlton · 5km", options: ["Carlton", "CBD", "Fitzroy"] },
];

function PlanningScreen() {
  return (
    <ScreenChrome>
      <div className="px-5 pt-7">
        <h3 className="display text-[34px]">Touch grass</h3>
      </div>
      <div className="relative mt-6 h-[500px]">
        <span className="rail" style={{ top: 0, bottom: 120 }} />
        {CHIPS.map((c, i) => {
          const Icon = c.icon;
          return (
            <div key={c.label} className="absolute left-0 right-5" style={{ top: i * 92 }}>
              <RailNode top={22} state="locked" />
              <div className="ml-[52px]">
                <div className="flex items-center gap-2 text-accent">
                  <Icon className="h-[15px] w-[15px]" />
                  <span className="board text-[9px]">{c.label}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {c.options.map((o) => (
                    <Chip key={o} selected={o === c.value} onClick={() => {}}>
                      {o}
                    </Chip>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
        <div className="absolute inset-x-5 bottom-6">
          <Plate variant="action" label="Open the room" right="→" />
        </div>
      </div>
    </ScreenChrome>
  );
}

const CREW = [
  { name: "You", state: "locked" as const, note: "host" },
  { name: "Tam", state: "locked" as const, note: "joined" },
  { name: "Bec", state: "live" as const, note: "joining" },
  { name: "", state: "open" as const, note: "waiting" },
];

function RoomScreen() {
  return (
    <ScreenChrome live="Now boarding">
      <div className="px-5 pt-7">
        <p className="board text-[9px] text-dim">Room</p>
        <p className="num mt-1 text-[52px] leading-none">4471</p>
      </div>
      <div className="relative mt-8 h-[380px]">
        <span className="rail" style={{ top: 0, bottom: 90 }} />
        {CREW.map((p, i) => (
          <div key={i} className="absolute left-0 right-5" style={{ top: i * 62 }}>
            <RailNode top={8} state={p.state} />
            <div className="ml-[52px] flex items-baseline justify-between border-b border-hairline pb-3">
              <span className={p.name ? "display text-[21px]" : "text-[15px] text-dim"}>
                {p.name || "Seat open"}
              </span>
              <span className="board text-[9px] text-dim">{p.note}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="absolute inset-x-5 bottom-6 space-y-2">
        <p className="text-[12px] leading-snug text-dim">
          Send the link. They type a first name and they are in — no account, no quiz.
        </p>
        <Plate variant="action" label="Copy join link" />
      </div>
    </ScreenChrome>
  );
}

function DeckScreen() {
  return (
    <ScreenChrome live="3 of 4 swiping">
      <div className="mt-5">
        <MapTile className="h-[172px] w-full" />
      </div>
      <div className="px-5 pt-5">
        <div className="flex items-center gap-2">
          <span
            className="board px-2 py-1 text-[9px]"
            style={{ background: "var(--accent)", color: "var(--ground)" }}
          >
            Free
          </span>
          <span className="board text-[9px] text-dim">Card 2 of 9</span>
        </div>
        <h3 className="display mt-3 text-[36px]">Princes Park</h3>
        <p className="mt-3 text-[14px] leading-relaxed text-dim">
          A full lap is 3.2km and the light goes at 8. Bring something to sit on.
        </p>
        <div className="mt-5 flex gap-6 border-t border-hairline pt-4">
          <div>
            <p className="board text-[9px] text-dim">Each</p>
            <p className="num text-[24px] text-accent">$0</p>
          </div>
          <div>
            <p className="board text-[9px] text-dim">Away</p>
            <p className="num text-[24px]">2.4km</p>
          </div>
          <div>
            <p className="board text-[9px] text-dim">Start</p>
            <p className="num text-[24px]">6:30</p>
          </div>
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 flex">
        <button
          className="board flex flex-1 items-center justify-center gap-2 py-5 text-[11px]"
          style={{ background: "var(--ground-raised)", color: "var(--text)" }}
        >
          <Cross className="h-4 w-4" /> Nah
        </button>
        <button
          className="board flex flex-1 items-center justify-center gap-2 py-5 text-[11px]"
          style={{ background: "var(--action)", color: "var(--on-action)" }}
        >
          <Check className="h-4 w-4" /> I&apos;m in
        </button>
      </div>
    </ScreenChrome>
  );
}

function MatchScreen() {
  const [step, setStep] = useState(BOARD.length - 1);
  const [run, setRun] = useState(0);

  function replay() {
    setRun((r) => r + 1);
    setStep(0);
    BOARD.forEach((_, i) => {
      if (i > 0) setTimeout(() => setStep(i), i * 560);
    });
  }

  const settled = step === BOARD.length - 1;

  return (
    <ScreenChrome live={settled ? "Everyone said yes" : "Resolving"}>
      <div className="flex h-full flex-col justify-between px-5 pb-6 pt-10">
        <div>
          <p className="board text-[10px] text-accent">Tonight, 6:30</p>
          <p
            key={`${run}-${step}`}
            className="flap display mt-4 text-[44px]"
            aria-live="polite"
          >
            {BOARD[step]}
          </p>
          {settled && (
            <p className="mt-5 max-w-[30ch] text-[14px] leading-relaxed text-dim">
              Four out of four. Nobody had to suggest it, so nobody has to defend it.
            </p>
          )}
        </div>

        <div className="relative h-[210px]">
          <Rail drawing key={`rail-${run}`} />
          <RailNode top={4} state="locked" />
          <RailNode top={92} state="locked" />
          <RailNode top={180} state="locked" />
          <div className="ml-[52px] space-y-[52px]">
            {[
              ["6:30", "Meet at the Royal Pde gate"],
              ["7:15", "Lap, then the north bench"],
              ["8:40", "Pizza on the walk back"],
            ].map(([t, l]) => (
              <div key={t}>
                <p className="num text-[17px] text-accent">{t}</p>
                <p className="text-[13px] text-dim">{l}</p>
              </div>
            ))}
          </div>
        </div>

        <Plate variant="action" label="Replay the flip" onClick={replay} />
      </div>
    </ScreenChrome>
  );
}

const STOPS = [
  { t: "6:30", kind: "Meet", name: "Royal Pde gate", cost: "$0", locked: true },
  { t: "7:15", kind: "Main", name: "The north bench", cost: "$0", locked: true },
  { t: "8:40", kind: "After", name: "Toto's, Lygon St", cost: "$14", locked: false },
];

function PlanScreen() {
  return (
    <ScreenChrome live="1 proposal open">
      <div className="px-5 pt-7">
        <h3 className="display text-[30px]">Tonight</h3>
        <p className="num mt-1 text-[13px] text-dim">4 people · $14 each · under $30</p>
      </div>

      <div className="relative mt-7 h-[300px]">
        <span className="rail" style={{ bottom: 60 }} />
        {STOPS.map((s, i) => (
          <div key={s.t} className="absolute left-0 right-5" style={{ top: i * 96 }}>
            <RailNode top={6} state={s.locked ? "locked" : "live"} />
            <div className="ml-[52px]">
              <div className="flex items-baseline gap-3">
                <span className="num text-[15px] text-accent">{s.t}</span>
                <span className="board text-[9px] text-dim">{s.kind}</span>
                <span className="num ml-auto text-[13px]">{s.cost}</span>
              </div>
              <p className="display mt-1 text-[20px]">{s.name}</p>
              <div className="mt-2 flex gap-1.5">
                {s.locked ? (
                  <span className="board flex items-center gap-1.5 px-2 py-1 text-[9px] text-accent">
                    <Lock className="h-3 w-3" /> Locked
                  </span>
                ) : (
                  <>
                    <button
                      className="board flex items-center gap-1.5 px-2 py-1 text-[9px]"
                      style={{ background: "var(--ground-raised)" }}
                    >
                      <Swap className="h-3 w-3" /> Swap
                    </button>
                    <button
                      className="board flex items-center gap-1.5 px-2 py-1 text-[9px]"
                      style={{ background: "var(--ground-raised)" }}
                    >
                      <Hand className="h-3 w-3" /> Propose
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="absolute inset-x-5 bottom-6">
        <div className="p-3" style={{ background: "var(--action-quiet)", color: "var(--on-action)" }}>
          <p className="board text-[9px]">Tam proposes · Heartattack and Vine</p>
          <div className="mt-2 flex items-center gap-2">
            <span className="num text-[12px]">2 of 4 · needs 3</span>
            <button
              className="board ml-auto px-2.5 py-1 text-[9px]"
              style={{ background: "var(--ground)", color: "var(--text)" }}
            >
              Yes
            </button>
          </div>
        </div>
      </div>
    </ScreenChrome>
  );
}

function BookedScreen() {
  return (
    <ScreenChrome live="Confirmed">
      <div className="flex h-full flex-col justify-between px-5 pb-6 pt-10">
        <div>
          <p className="board text-[10px] text-accent">Booked · Wed 6:30</p>
          <h3 className="display mt-4 text-[40px]">Princes Park, then Toto&apos;s</h3>
          <div className="mt-8 border-t border-hairline pt-5">
            <p className="board text-[9px] text-dim">Reference</p>
            <p className="num text-[38px] leading-none">QL-4471</p>
          </div>
          <div className="mt-6 flex gap-8">
            <div>
              <p className="board text-[9px] text-dim">Each</p>
              <p className="num text-[22px] text-accent">$14</p>
            </div>
            <div>
              <p className="board text-[9px] text-dim">Party</p>
              <p className="num text-[22px]">4</p>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-[11px] leading-snug text-dim">
            Demonstration booking. No table has been held and no venue has been contacted.
          </p>
          <Plate variant="action" label="Open Toto's in Maps" />
          <Plate variant="raised" label="Send to the group chat" />
        </div>
      </div>
    </ScreenChrome>
  );
}

/* ------------------------------------------------------------------- notes */

function Notes() {
  return (
    <section className="mt-20 border-t border-hairline pt-12">
      <h2 className="display text-[clamp(1.7rem,4vw,2.6rem)]">What this commits you to</h2>
      <div className="mt-8 grid gap-10 md:grid-cols-3">
        {[
          [
            "Orange never carries text",
            "2.9:1 on iris, 3.5:1 on cornsilk. It is a field colour with ink on top in both modes, everywhere, forever.",
          ],
          [
            "The accent swaps, the meaning does not",
            "Apricot reads at night and vanishes by day (1.8:1), so iris takes over. A price is still the accent colour — the colour just changes with the light.",
          ],
          [
            "Every screen is one decision",
            "The line has stops, not sections. If a screen offers two equal choices it has stopped being a route and gone back to being a feed.",
          ],
        ].map(([h, b]) => (
          <div key={h}>
            <h3 className="display text-[19px]">{h}</h3>
            <p className="mt-3 text-[14px] leading-relaxed text-dim">{b}</p>
          </div>
        ))}
      </div>
      <p className="mt-12 max-w-[70ch] text-[13px] leading-relaxed text-dim">
        Venues shown are demonstration content. Princes Park, Lygon Street and the Tan are
        public places named as themselves; no venue on this page is a Questly partner and
        no booking here is real.
      </p>
    </section>
  );
}
