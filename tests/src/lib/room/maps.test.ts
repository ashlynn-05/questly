import { expect, test } from "vitest";
// Relative, not the `@convex/*` alias, matching `photo.test.ts` in this folder.
import { UNNAMED_STOP } from "../../../../convex/lib/plans/stops";
import {
  MAPS_AREA,
  stopQuery,
  stopsDirectionsUrl,
  stopsEmbedUrl,
  venueMapsUrl,
} from "../../../../src/lib/room/maps";

/**
 * The URL builders behind the maps links, and the two facts about them that a
 * reader would otherwise have to take on trust: that a card links to the venue
 * rather than its website, and that a plan links to the ROUTE rather than to
 * whichever stop happens to be first.
 *
 * Builders only. `vitest.config.ts` runs on `edge-runtime` with no jsdom and no
 * React testing library, and no component in this repository has a test -- so
 * the iframe, the 44px targets and the keyboard path are verified in a browser,
 * not padded into this file as assertions that would only be testing React.
 */

const stop = (name: string, placeId?: string) => ({ name, placeId });

test("a card links to Google's own URI for the place when it has one", () => {
  expect(venueMapsUrl({ title: "The Alderman", mapsUri: "https://maps.app.goo.gl/x1" })).toBe(
    "https://maps.app.goo.gl/x1",
  );
});

test("a card with no stored URI falls back to a search for the venue in the city", () => {
  const url = new URL(venueMapsUrl({ title: "The Alderman" }));
  expect(url.origin + url.pathname).toBe("https://www.google.com/maps/search/");
  expect(url.searchParams.get("query")).toBe(`The Alderman ${MAPS_AREA}`);
});

test("a card link never falls through to the venue's own website", () => {
  // The deliberate difference from `convex/bookings.ts`, whose `deepLink` means
  // "everything I need to get there" and may answer with a homepage. This
  // control says Maps, so it goes to Maps or it goes to a Maps search.
  const url = venueMapsUrl({
    title: "The Alderman",
    // @ts-expect-error -- websiteUri is not part of the input type, and this
    // asserts that adding it to a quest can never change the answer.
    websiteUri: "https://thealderman.com.au",
  });
  expect(url).not.toContain("thealderman.com.au");
  expect(url).toContain("google.com/maps");
});

test("a stop with a place id is asked for by id, not by name", () => {
  // Exact, and survives a venue renaming itself. Only set after a swap --
  // `convex/lib/plans/search.ts` is the sole writer.
  expect(stopQuery(stop("Whatever The Model Called It", "ChIJ123"))).toBe("place_id:ChIJ123");
});

test("a stop with only a name is disambiguated by the city", () => {
  expect(stopQuery(stop("Meet outside The Alderman"))).toBe(
    `Meet outside The Alderman, ${MAPS_AREA}`,
  );
});

test("the unnamed-stop fallback is never handed to Google", () => {
  // Imported from the Convex module, so renaming the literal there turns this
  // red rather than silently putting a wrong pin on the plan screen.
  expect(stopQuery(stop(UNNAMED_STOP))).toBeNull();
  expect(stopQuery(stop("   "))).toBeNull();
});

test("a route needs at least two findable stops", () => {
  expect(stopsDirectionsUrl([])).toBeNull();
  expect(stopsDirectionsUrl([stop("The Alderman")])).toBeNull();
  // Two stops, but one of them is unnamed, so there is still only one place to
  // draw and no route to draw it as.
  expect(stopsDirectionsUrl([stop("The Alderman"), stop(UNNAMED_STOP)])).toBeNull();
});

test("a route runs from the first stop to the last, through the ones between", () => {
  const url = new URL(
    stopsDirectionsUrl([stop("Meet"), stop("Main"), stop("After")]) ?? "",
  );
  expect(url.origin + url.pathname).toBe("https://www.google.com/maps/dir/");
  expect(url.searchParams.get("origin")).toBe(`Meet, ${MAPS_AREA}`);
  expect(url.searchParams.get("destination")).toBe(`After, ${MAPS_AREA}`);
  expect(url.searchParams.get("waypoints")).toBe(`Main, ${MAPS_AREA}`);
});

test("two stops make a route with no waypoints at all", () => {
  const url = new URL(stopsDirectionsUrl([stop("Meet"), stop("After")]) ?? "");
  expect(url.searchParams.get("origin")).toBe(`Meet, ${MAPS_AREA}`);
  expect(url.searchParams.get("destination")).toBe(`After, ${MAPS_AREA}`);
  expect(url.searchParams.has("waypoints")).toBe(false);
});

test("waypoints are capped at three, trimmed from the middle", () => {
  // Google allows only three on mobile browsers, which is where this product is
  // used, and past the ceiling the link stops working rather than degrading.
  // The first and last stop are where the night begins and ends, so the cut
  // comes out of the middle.
  const url = new URL(
    stopsDirectionsUrl(
      ["A", "B", "C", "D", "E", "F"].map((n) => stop(n)),
    ) ?? "",
  );
  expect(url.searchParams.get("origin")).toBe(`A, ${MAPS_AREA}`);
  expect(url.searchParams.get("destination")).toBe(`F, ${MAPS_AREA}`);
  expect(url.searchParams.get("waypoints")?.split("|")).toHaveLength(3);
});

test("stops that cannot be found are skipped, not left as gaps in the route", () => {
  const url = new URL(
    stopsDirectionsUrl([stop("Meet"), stop(UNNAMED_STOP), stop("After")]) ?? "",
  );
  expect(url.searchParams.get("origin")).toBe(`Meet, ${MAPS_AREA}`);
  expect(url.searchParams.get("destination")).toBe(`After, ${MAPS_AREA}`);
  expect(url.searchParams.has("waypoints")).toBe(false);
});

test("no embed without a key, and none without a route", () => {
  // The whole of this feature's failure handling: a missing key is a fact known
  // at build time, so the plan screen asks, gets null, and renders without a map.
  const stops = [stop("Meet"), stop("Main"), stop("After")];
  expect(stopsEmbedUrl(stops, undefined)).toBeNull();
  expect(stopsEmbedUrl(stops, "")).toBeNull();
  expect(stopsEmbedUrl([stop("Meet")], "key-abc")).toBeNull();
});

test("the embed carries the key and the same route as the link", () => {
  const stops = [stop("Meet"), stop("Main", "ChIJ123"), stop("After")];
  const url = new URL(stopsEmbedUrl(stops, "key-abc") ?? "");
  expect(url.origin + url.pathname).toBe("https://www.google.com/maps/embed/v1/directions");
  expect(url.searchParams.get("key")).toBe("key-abc");
  expect(url.searchParams.get("origin")).toBe(`Meet, ${MAPS_AREA}`);
  expect(url.searchParams.get("waypoints")).toBe("place_id:ChIJ123");
  expect(url.searchParams.get("destination")).toBe(`After, ${MAPS_AREA}`);
});

test("a venue name carrying a space and an ampersand survives the round trip", () => {
  // `&` unescaped would end the query string early and silently drop every
  // parameter after it, which is a broken link with no error anywhere.
  const url = new URL(stopsDirectionsUrl([stop("Bar & Grill"), stop("After")]) ?? "");
  expect(url.searchParams.get("origin")).toBe(`Bar & Grill, ${MAPS_AREA}`);
  expect(url.searchParams.get("destination")).toBe(`After, ${MAPS_AREA}`);
});
