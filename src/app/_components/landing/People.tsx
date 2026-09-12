import Image from "next/image";
import type { ReactNode } from "react";

/**
 * Who Questly is for, drawn as the design's persona block.
 *
 * THE HEADING IS NOT "WHAT OUR CUSTOMERS SAID". The comp says that, and it
 * cannot ship: PRODUCT.md forbids testimonials outright, and this build has no
 * customers to have said anything. What the comp actually drew underneath that
 * heading is three personas with a badge, a situation and a line of their own
 * speech -- which is a "who this is for" block wearing a testimonial's clothes.
 * So the artwork stays and the claim goes. The badges are the comp's own
 * ("Primary user", "Meets new people", "Treats himself") and they read as
 * segments, which is what they are.
 *
 * The portraits are stock people, tilted in their frames the way the comp tilts
 * them. Nobody here is named as a user of a product that has not launched.
 */

type Person = {
  slug: string;
  first: string;
  rest: string;
  badge: string;
  quote: ReactNode;
};

const NOUR: Person = {
  slug: "nour",
  first: "Nour",
  rest: "Haddad, 24",
  badge: "Meets new people",
  quote: (
    <>
      Two taps and the{" "}
      <em className="text-text not-italic">argument was over</em> before it
      started.
    </>
  ),
};

const SAM: Person = {
  slug: "sam",
  first: "Sam",
  rest: "Okonkwo, 27",
  badge: "Treats himself",
  quote: (
    <>
      The <em className="text-text not-italic">$0 option</em> was the one we
      chose. Twice.
    </>
  ),
};

const CHIPS = ["Too many options", "Nobody decides", "Night gone"];

/** The comp's pill, at both of its sizes. `--rail` is the measured border. */
const BADGE =
  "board inline-flex items-center rounded-full border border-rail text-accent";

export function People() {
  return (
    <>
      {/* The lead persona. `--rail` into `--accent` across the panel is the
          comp's own wash; it sits on `--ground` because every text colour used
          inside is measured against that fill and not against the page. */}
      <div
        className="relative overflow-hidden rounded-[6px] bg-ground p-6 lg:p-12"
        style={{
          backgroundImage:
            "linear-gradient(120deg, color-mix(in oklab, var(--rail) 22%, transparent), transparent 45%, color-mix(in oklab, var(--accent) 14%, transparent))",
        }}
      >
        <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-12">
          <div className="mx-auto w-full max-w-[320px] rotate-[-4deg]">
            <div
              className="rounded-[10px] bg-ground-raised p-[10px]"
              style={{ boxShadow: "var(--shadow)" }}
            >
              <Image
                src="/brand/bea.jpeg"
                alt=""
                width={560}
                height={660}
                className="h-[300px] w-full rounded-[6px] object-cover lg:h-[360px]"
              />
            </div>
          </div>
          <div>
            <span className={`${BADGE} min-h-[30px] px-[14px] text-[10px]`}>
              Primary user
            </span>
            <p className="display m-0 mt-[18px] mb-2 text-[clamp(34px,6vw,56px)]">
              Bea <span className="text-dim">Chen, 21</span>
            </p>
            <p className="m-0 mb-[18px] max-w-[46ch] text-[14px] leading-[1.5] text-dim">
              Has the group chat and no plan. Opens a room, sends the number,
              stops the argument before it starts.
            </p>
            <p className="m-0 max-w-[34ch] text-[17px] leading-[1.5] text-dim">
              &ldquo;Some nights the chat has forty messages and no plan. Nobody
              wants to be the one who{" "}
              <em className="text-text not-italic">picks the place</em>, so we
              end up{" "}
              <em className="text-text not-italic">not going out at all</em>
              .&rdquo;
            </p>
            <div className="mt-[26px] flex flex-wrap gap-[10px]">
              {CHIPS.map((chip) => (
                <span
                  key={chip}
                  className="board inline-flex min-h-[36px] items-center rounded-full border border-hairline px-[14px] text-[10px] text-dim"
                >
                  {chip}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Small
          person={NOUR}
          tilt="rotate-[3deg]"
          wash="240deg"
          tint="var(--accent)"
        />
        <Small
          person={SAM}
          tilt="rotate-[-3deg]"
          wash="120deg"
          tint="var(--action)"
        />
      </div>
    </>
  );
}

function Small({
  person,
  tilt,
  wash,
  tint,
}: {
  person: Person;
  tilt: string;
  /** The comp runs the two washes in opposite directions so the pair mirrors. */
  wash: string;
  tint: string;
}) {
  return (
    <div
      className="flex items-center gap-5 rounded-[6px] bg-ground p-[22px]"
      style={{
        backgroundImage: `linear-gradient(${wash}, color-mix(in oklab, ${tint} 16%, transparent), transparent 60%)`,
      }}
    >
      <div className={`flex-none ${tilt}`}>
        <div
          className="rounded-[9px] bg-ground-raised p-[7px]"
          style={{ boxShadow: "var(--shadow)" }}
        >
          <Image
            src={`/brand/${person.slug}.jpeg`}
            alt=""
            width={440}
            height={262}
            className="h-[124px] w-[104px] rounded-[5px] object-cover"
          />
        </div>
      </div>
      <div>
        <span className={`${BADGE} min-h-[26px] px-3 text-[9px]`}>
          {person.badge}
        </span>
        <p className="display m-0 mt-3 mb-1 text-[26px]">
          {person.first} <span className="text-dim">{person.rest}</span>
        </p>
        <p className="m-0 text-[14px] leading-[1.45] text-dim">
          &ldquo;{person.quote}&rdquo;
        </p>
      </div>
    </div>
  );
}
