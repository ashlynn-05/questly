"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

/**
 * The phone at the centre of the fan, cycling the four screens the real funnel
 * carries: the sign-up quiz, then the three steps that open a room. The shape
 * and the headings are the funnel's own; the sub-lines are the comp's shorter
 * phrasings of them.
 *
 * WHY MOTION AND NOT CSS. Each screen leaves on a flip up and the next arrives
 * on a flip down, which needs the outgoing element to stay mounted while it
 * animates out. `AnimatePresence` is the one thing on this page `motion` is
 * used for; everything else is the CSS tokens in `globals.css`.
 *
 * WHY IT STOPS. It runs only while it is on screen, and not at all when motion
 * is reduced. `useReducedMotion()` returns `boolean | null` in motion 13, and
 * `null` is the undetermined first pass -- treated as REDUCED here, in both the
 * timer and the transition, so the undetermined case never starts something a
 * visitor asked not to see.
 *
 * WHY THE FRAME IS `aria-hidden`. The four `<h2>`s inside it would land between
 * the page's h1 and its first real h2. The `sr-only` paragraph below the frame
 * -- outside the hidden subtree, deliberately -- names the four steps once,
 * which is the whole of what the rotation conveys.
 */

const DUR = 2800;

function Head({
  mark,
  title,
  count,
}: {
  mark: string;
  title: string;
  count?: string;
}) {
  return (
    <>
      <div className="mb-4 flex items-baseline justify-between">
        <p className="board m-0 text-[9px] text-accent">{mark}</p>
        {count ? (
          <span className="num text-[11px] text-dim">{count}</span>
        ) : null}
      </div>
      <h2 className="display m-0 mb-[18px] text-[28px]">{title}</h2>
    </>
  );
}

/** An option row. The selected one is an orange field, as in the product. */
function Option({
  label,
  help,
  on = false,
}: {
  label: string;
  help?: string;
  on?: boolean;
}) {
  return (
    <span
      className={`block rounded-[5px] px-[14px] py-3 ${
        on
          ? "border border-action-edge bg-action text-on-action"
          : "bg-ground-raised text-text"
      }`}
    >
      <span className="board text-[11px]">{label}</span>
      {help ? (
        <span className={`mt-1 block text-[10px] ${on ? "" : "text-dim"}`}>
          {help}
        </span>
      ) : null}
    </span>
  );
}

/** The comp's four-segment progress bar. `done` segments are orange. */
function Progress({ done }: { done: number }) {
  return (
    <div className="mb-3 flex gap-[5px]">
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={`h-[3px] flex-1 rounded-[2px] ${i < done ? "bg-action" : "bg-hairline"}`}
        />
      ))}
    </div>
  );
}

const FOOT =
  "board flex min-h-[46px] items-center justify-center rounded-[5px] text-[11px]";

const SCREENS: ReactNode[] = [
  <>
    <Head
      mark="Getting to know you"
      title="Indoors or outdoors?"
      count="3 / 8"
    />
    <div className="flex flex-col gap-2">
      <Option label="Outdoors, always" on />
      <Option label="Indoors, comfortably" />
      <Option label="Whatever the weather says" />
    </div>
    <p className="m-0 mt-4 text-[11px] text-dim">
      These shape what we suggest. Picking none is a fine answer.
    </p>
    <div className="mt-auto pt-4">
      <Progress done={1} />
      <span className={`${FOOT} border border-dim text-text`}>
        Next question
      </span>
    </div>
  </>,
  <>
    <Head mark="Step 1 of 3" title="What kind of activity?" />
    <div className="flex flex-col gap-2">
      <Option
        label="Touch grass"
        help="A natural hangout. Outside, usually free."
      />
      <Option
        label="Random crazy sidequests"
        help="Visit an old school fairy tale theme park."
        on
      />
      <Option label="Hang-outs" help="A girly hangout in the city." />
    </div>
    <div className="mt-auto pt-4">
      <Progress done={2} />
      <span
        className={`${FOOT} border border-action-edge bg-action text-on-action`}
      >
        Continue
      </span>
    </div>
  </>,
  <>
    <Head mark="Step 2 of 3" title="Who is coming?" />
    <div className="flex flex-col gap-2">
      <Option
        label="Treat yourself"
        help="A solo sidequest. Same plan, no voting."
      />
      <Option
        label="Spend time with people"
        help="Meet new people, or bring your friends."
        on
      />
    </div>
    <div className="mt-[14px] flex gap-[7px]">
      <span className="board flex min-h-[44px] flex-1 items-center justify-center rounded-[5px] border border-dim text-[10px] text-text">
        Meet new people
      </span>
      <span className="board flex min-h-[44px] flex-1 items-center justify-center rounded-[5px] border border-dim text-[10px] text-text">
        Hang out with friends
      </span>
    </div>
    <div className="mt-auto pt-4">
      <Progress done={3} />
      <span
        className={`${FOOT} border border-action-edge bg-action text-on-action`}
      >
        Continue
      </span>
    </div>
  </>,
  <>
    <Head mark="Step 3 of 3 · Room 4821" title="Set the room." />
    <p className="board m-0 mb-[7px] text-[9px] text-accent">How many people</p>
    <div className="mb-[14px] flex gap-[6px]">
      {["2", "3", "4", "5"].map((n) => (
        <span
          key={n}
          className={`num flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[5px] border text-[13px] ${
            n === "4"
              ? "border-accent bg-accent text-ground"
              : "border-dim text-dim"
          }`}
        >
          {n}
        </span>
      ))}
    </div>
    <p className="board m-0 mb-[7px] text-[9px] text-accent">
      Locations · budget per head · when · how far
    </p>
    <div className="flex flex-wrap gap-[6px]">
      {["2 stops", "$20", "7:30", "5 km"].map((chip) => (
        <span
          key={chip}
          className={`num inline-flex min-h-[36px] items-center rounded-[5px] border px-[11px] text-[12px] ${
            chip === "2 stops"
              ? "border-accent bg-accent text-ground"
              : "border-dim text-dim"
          }`}
        >
          {chip}
        </span>
      ))}
    </div>
    <div className="mt-auto pt-4">
      <Progress done={4} />
      <span
        className={`${FOOT} border border-action-edge bg-action text-on-action`}
      >
        Open the room
      </span>
      <p className="m-0 mt-[10px] text-[10px] text-dim">
        Then everyone swipes the same deck.
      </p>
    </div>
  </>,
];

export function PhoneFlow() {
  const frame = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    // `null` is the undetermined pass: nothing starts until it resolves false.
    if (reduceMotion !== false) return;
    const node = frame.current;
    if (!node) return;

    let timer: ReturnType<typeof setInterval> | undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        // Offscreen it stops entirely -- a phone flipping in a tab nobody is
        // looking at is a timer burning a battery.
        if (entry.isIntersecting) {
          timer ??= setInterval(
            () => setIndex((i) => (i + 1) % SCREENS.length),
            DUR,
          );
        } else {
          clearInterval(timer);
          timer = undefined;
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      clearInterval(timer);
    };
  }, [reduceMotion]);

  return (
    <div className="absolute bottom-0 left-1/2 z-10 -ml-[150px] h-[480px] w-[300px] max-w-[calc(100%-2.5rem)]">
      <div
        ref={frame}
        aria-hidden="true"
        className="relative h-full w-full overflow-hidden rounded-[24px] border border-hairline bg-ground text-left"
        style={{ boxShadow: "var(--shadow)", perspective: 900 }}
      >
        {/* `initial={false}` so the first screen mounts at rest rather than
            flipping in from nothing on load. */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={index}
            initial={{ rotateX: -84, opacity: 0 }}
            animate={{ rotateX: 0, opacity: 1 }}
            exit={{ rotateX: 84, opacity: 0 }}
            transition={
              reduceMotion !== false
                ? { duration: 0 }
                : { duration: 0.31, ease: [0.16, 1, 0.3, 1] }
            }
            className="absolute inset-0 flex flex-col justify-center px-[22px] py-6"
          >
            {SCREENS[index]}
          </motion.div>
        </AnimatePresence>
      </div>
      {/* Outside the hidden frame on purpose: this sentence is the accessible
          substitute for everything the fan shows. */}
      <p className="sr-only">
        A phone cycling four Questly screens: eight questions at sign-up, then
        what kind of activity, then who is coming, then the room settings before
        everyone swipes the same deck.
      </p>
    </div>
  );
}
