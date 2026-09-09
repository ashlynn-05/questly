/**
 * The agreed night, as one Google Calendar event.
 *
 * The booked screen could send the plan to a chat and open it on a map, and
 * then the times existed only inside Questly: no phone knew about them and
 * nothing reminded anybody. This is the link that fixes that.
 *
 * WHICH GOOGLE SURFACE, and why, because "add to calendar" has three answers
 * with very different costs:
 *
 *   Calendar template URL   no auth, no quota, no charge   Google Calendar
 *   Calendar API            OAuth scope + consent screen   Google Calendar
 *   A downloaded .ics file  no auth, no charge             Google, Apple, Outlook
 *
 * The template URL wins the same way the Maps Embed API won next door: it is a
 * plain link, it costs nothing, and it asks the person for no permission this
 * product does not already have. The API would need a scope, a consent screen
 * and a backend action to write an event a URL writes for free. An .ics file
 * would reach Apple and Outlook too, and stays the upgrade path if that is ever
 * asked for -- but a downloaded file is the worse path on the phone this
 * product is used on, and the ask was Google.
 *
 * Pure, so `tests/src/lib/room/calendar.test.ts` can hold every branch.
 */

import { MAPS_AREA } from "./maps";
import { planShareText } from "./share";

const TEMPLATE = "https://calendar.google.com/calendar/render";

type CalendarStop = {
  id: string;
  name: string;
  startAt: number;
  durationMin: number;
  costPerHeadCents: number;
  placeId?: string;
};

/**
 * An instant, in the only format that cannot be misread.
 *
 * UTC, with the `Z`. Melbourne crosses a daylight-saving boundary in October
 * and this product plans nights on both sides of it; a local time plus a zone
 * name is one more thing for Google to resolve differently from us. An instant
 * resolves to itself.
 */
function stamp(at: number): string {
  return new Date(at).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** What the calendar row says before anybody opens it. */
function title(stops: readonly CalendarStop[]): string {
  const rest = stops.length - 1;
  if (rest < 1) return `Questly: ${stops[0].name}`;
  return `Questly: ${stops[0].name} and ${rest} more`;
}

/**
 * The whole night as one calendar event, or null when there is nothing to put
 * in a diary.
 *
 * ONE event, not one per stop. A template URL creates exactly one, so per-stop
 * blocks would be three separate links and three round trips through Google's
 * own screens; the stop times live in the description instead, where they are
 * one tap away rather than three.
 *
 * A single stop still gets an event, which is where this parts company with
 * `stopsDirectionsUrl`: one place with a duration is a real evening, where one
 * place is not a route.
 */
export function calendarUrl({
  intro,
  stops,
  perHeadCents,
  roomUrl,
}: {
  intro: string;
  stops: readonly CalendarStop[];
  perHeadCents: number;
  roomUrl: string;
}): string | null {
  if (!stops.length) return null;

  const first = stops[0];
  const last = stops[stops.length - 1];
  // The last stop's OWN duration, not `TRAVEL_BUFFER_MIN`. The buffer is time
  // between stops; adding it here would book fifteen minutes of walking to
  // nowhere onto the end of the night.
  const endsAt = last.startAt + last.durationMin * 60_000;

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title(stops),
    dates: `${stamp(first.startAt)}/${stamp(endsAt)}`,
    // The same string the group chat gets. Not a second formatter: two would
    // drift, and then the calendar entry and the message would disagree about
    // a night both claim to describe.
    details: planShareText({ intro, stops, perHeadCents, roomUrl }),
    // Google shows exactly one location, so it is the first stop -- where
    // people are actually heading when the entry fires.
    location: `${first.name}, ${MAPS_AREA}`,
  });

  return `${TEMPLATE}?${params.toString()}`;
}
