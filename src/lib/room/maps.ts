/**
 * Where things are, for the two screens that could not say.
 *
 * The deck shows distance as a number, and a number is not a location; the plan
 * shows three stops in sequence with nothing to say whether they are next door
 * or across town. These builders answer both with Google, and they are pure so
 * `tests/src/lib/room/maps.test.ts` can hold every branch without a DOM.
 *
 * WHICH GOOGLE SURFACE, and why, because "add a map" has four answers with very
 * different bills attached. Measured against the current pricing list:
 *
 *   Maps Embed API (iframe)   SKU 9C10-8313-F21F   unlimited, no charge
 *   Maps JS SDK (Dynamic)     SKU FAF4-3B2D-51B2   10k/mo free, then $7/1000
 *   Static Maps (an image)    SKU 3C2D-B525-2E5F   10k/mo free, then $2/1000
 *   Maps URLs (a plain link)  not a SKU            no charge
 *
 * So: plain links wherever a link will do, and the free iframe for the one place
 * that wants a drawn route. `@vis.gl/react-google-maps` is in package.json and
 * is deliberately NOT used here -- it loads Dynamic Maps, which is the priciest
 * row in that table, to draw a map the free row already draws. Being installed
 * already is not a reason to start billing.
 */

import { UNNAMED_STOP } from "@convex/lib/plans/stops";

/**
 * The city every one of these queries is disambiguated against.
 *
 * The same string `convex/bookings.ts` appends to its search fallback and
 * `convex/lib/plans/prompt.ts` writes into the prompt. One idea of where this
 * product operates, not a third: "The Alderman" alone matches venues on four
 * continents.
 */
export const MAPS_AREA = "Melbourne";

/**
 * Google's ceiling on intermediate stops, and the reason it is enforced here.
 *
 * The Maps URLs docs allow nine waypoints on desktop but only THREE on mobile
 * browsers, which is where this product is used. Past the ceiling the link does
 * not degrade -- it stops working. `parsePlanResponse` slices model output to
 * four stops, so today's worst case is two waypoints and this never trips; it is
 * enforced anyway because the next person to raise that slice will not read this
 * file.
 */
const MAX_WAYPOINTS = 3;

/** What a stop needs to carry to be findable. See `stopValidator`. */
type MappableStop = { name: string; placeId?: string };

/** What a card needs to carry to be linkable. See the `quests` table. */
type MappableQuest = { title: string; mapsUri?: string };

function searchUrl(query: string): string {
  const params = new URLSearchParams({ api: "1", query });
  return `https://www.google.com/maps/search/?${params.toString()}`;
}

/**
 * Where one deck card is, on Google Maps.
 *
 * `mapsUri` is Google's own canonical link for the place and is stored on every
 * quest already; the search URL is the same fallback `convex/bookings.ts` builds
 * when a place has none.
 *
 * NOT `websiteUri`, which is the one way this differs from the booked screen's
 * `deepLink`. That link means "everything I need to get there", so a venue's own
 * site is a fair answer. This one sits under a control that says Maps, and
 * opening a restaurant's homepage instead would be the control lying.
 */
export function venueMapsUrl(quest: MappableQuest): string {
  return quest.mapsUri ?? searchUrl(`${quest.title} ${MAPS_AREA}`);
}

/**
 * How to ask Google for one stop, or null if there is no honest way to.
 *
 * A place id is exact and survives a venue renaming itself, so it wins whenever
 * a stop has one -- which is only after a swap, because `search.ts` is the sole
 * writer of `placeId` and plan generation never sets it. Everything else is the
 * model's free text, and that is genuinely fine for a real name: "Meet outside
 * The Alderman, Melbourne" resolves to the Alderman.
 *
 * `UNNAMED_STOP` is the exception and the reason this returns a union. It is
 * what the parser writes when the model gave no name at all, it geocodes to
 * whatever Google feels like, and a confidently wrong pin on the plan screen is
 * worse than a stop the map does not draw.
 */
export function stopQuery(stop: MappableStop): string | null {
  if (stop.placeId) return `place_id:${stop.placeId}`;
  const name = stop.name.trim();
  if (!name || name === UNNAMED_STOP) return null;
  return `${name}, ${MAPS_AREA}`;
}

/**
 * The stops that can be put on a map, in order, capped to what a route can hold.
 *
 * Fewer than two is not a route -- a journey needs somewhere to start and
 * somewhere to end -- so both callers below treat that as "no map", which is how
 * the plan screen survives a night the model named badly.
 */
function routeQueries(stops: readonly MappableStop[]): string[] | null {
  const queries = stops.map(stopQuery).filter((q): q is string => q !== null);
  if (queries.length < 2) return null;
  // Trim from the MIDDLE: the first and last stop are where the night starts
  // and ends, and dropping either changes what the route means. A middle stop
  // dropped past the ceiling is one pin missing from a link that still works.
  if (queries.length > MAX_WAYPOINTS + 2) {
    return [
      queries[0],
      ...queries.slice(1, 1 + MAX_WAYPOINTS),
      queries[queries.length - 1],
    ];
  }
  return queries;
}

/**
 * The whole night as one Google Maps route, or null when it cannot be drawn.
 *
 * This is what "show it on the map" should always have meant. The booked screen
 * used to link `booking.deepLink`, which `convex/bookings.ts` builds from the
 * ANCHOR QUEST ALONE -- so a button offering the night showed one venue and left
 * the group to find the other two themselves.
 *
 * No `travelmode`. Google picks the most relevant one for the route and the
 * user's own preferences; hardcoding a guess between walking and transit would
 * be wrong for half the nights this product plans, and there is nothing in a
 * plan that says which.
 */
export function stopsDirectionsUrl(stops: readonly MappableStop[]): string | null {
  const queries = routeQueries(stops);
  if (!queries) return null;

  const params = new URLSearchParams({
    api: "1",
    origin: queries[0],
    destination: queries[queries.length - 1],
  });
  const waypoints = queries.slice(1, -1);
  if (waypoints.length) params.set("waypoints", waypoints.join("|"));

  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/**
 * The same route as an embeddable iframe src, or null when there is nothing to
 * embed or no key to embed it with.
 *
 * Returning null on a missing key is the whole of this feature's failure
 * handling, and it is deliberately not more than that. The key is a
 * `NEXT_PUBLIC_` build variable, so its absence is a fact known at render time
 * rather than a request that might fail -- the plan screen asks, gets null, and
 * renders the night without a map. No loading state, no error boundary, no
 * retry: there is nothing in flight to have any of those.
 */
export function stopsEmbedUrl(
  stops: readonly MappableStop[],
  apiKey: string | undefined,
): string | null {
  if (!apiKey) return null;
  const queries = routeQueries(stops);
  if (!queries) return null;

  const params = new URLSearchParams({
    key: apiKey,
    origin: queries[0],
    destination: queries[queries.length - 1],
  });
  const waypoints = queries.slice(1, -1);
  if (waypoints.length) params.set("waypoints", waypoints.join("|"));

  return `https://www.google.com/maps/embed/v1/directions?${params.toString()}`;
}
