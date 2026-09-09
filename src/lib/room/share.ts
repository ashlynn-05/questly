/**
 * The night, written out for a group chat.
 *
 * What was sent before was `plan.shareMessage` alone: one line the model wrote,
 * with no times, no prices and no way to find anywhere. It read like a rumour.
 * A group chat is where this plan is actually agreed to, so the message has to
 * carry the whole itinerary and a way to each stop -- otherwise everybody who
 * reads it asks the same three questions back.
 *
 * Pure, and here rather than in `Booked.tsx`, for the reason the rest of
 * `src/lib` is: `vitest.config.ts` runs one `edge-runtime` environment with no
 * DOM, so a rule written inside a component cannot be tested at all.
 *
 * PLAIN TEXT, deliberately. `navigator.share` hands this to whatever the person
 * picks -- SMS, WhatsApp, Signal, Mail -- and not one of them agrees on
 * Markdown. Bullets are the character, line breaks are the layout, and the URLs
 * are bare so that every one of those apps linkifies them.
 */

import { stopMapsUrl, stopsDirectionsUrl } from "./maps";

/** The clock, as this product writes it everywhere else. */
export function timeLabel(at: number): string {
  return new Date(at).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
}

/** A price, or the word for not having one. */
export function moneyLabel(cents: number): string {
  return cents === 0 ? "Free" : `$${Math.round(cents / 100)}`;
}

/** The day, so a message read tomorrow is not read as being about tonight. */
function dayLabel(at: number): string {
  return new Date(at).toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

type ShareStop = {
  id: string;
  name: string;
  startAt: number;
  costPerHeadCents: number;
  placeId?: string;
};

export function planShareText({
  intro,
  stops,
  perHeadCents,
  roomUrl,
}: {
  /** The model's own line. First, because it is the only part written for people. */
  intro: string;
  stops: readonly ShareStop[];
  perHeadCents: number;
  roomUrl: string;
}): string {
  const blocks: string[] = [];

  const opening = intro.trim();
  if (opening) blocks.push(opening);

  if (stops.length) {
    blocks.push(dayLabel(stops[0].startAt));

    // One bullet per stop, its own map link indented under it. Indented rather
    // than run onto the same line: a URL with words after it is where chat apps
    // most often swallow the last character into the link.
    blocks.push(
      stops
        .map((stop) => {
          const line = `• ${timeLabel(stop.startAt)} — ${stop.name} (${moneyLabel(
            stop.costPerHeadCents,
          )})`;
          const where = stopMapsUrl(stop);
          // A stop the model never named has no honest link, and a bullet with
          // a dead URL under it is worse than a bullet without one.
          return where ? `${line}\n  ${where}` : line;
        })
        .join("\n"),
    );
  }

  // The stacked link: every stop as one route, which is the thing nobody can
  // reconstruct from three separate pins. Absent when there are fewer than two
  // findable stops, because there is no route to draw.
  const route = stopsDirectionsUrl(stops);
  if (route) blocks.push(`All of it on one map:\n${route}`);

  blocks.push(`${moneyLabel(perHeadCents)} each. The room: ${roomUrl}`);

  return blocks.join("\n\n");
}
