/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const API_KEY = "test-google-maps-key";

// The exact field mask string is the billing SKU switch -- pin it verbatim so
// it can never drift silently. Keep this list in the same order as places.ts.
const EXPECTED_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.rating",
  "places.userRatingCount",
  "places.primaryType",
  "places.primaryTypeDisplayName",
  "places.types",
  "places.priceLevel",
  "places.editorialSummary",
  "places.googleMapsUri",
  "places.websiteUri",
  "places.photos",
  "places.currentOpeningHours.openNow",
].join(",");

// A representative Places API (New) response body: one fully-populated place
// and one with every optional field absent (no photo, no price level, no
// rating) -- the shape a brand-new, unreviewed listing actually returns.
const RAW_RESPONSE = {
  places: [
    {
      id: "place-1",
      displayName: { text: "Proud Mary Coffee" },
      formattedAddress: "172 Oxford St, Collingwood VIC",
      location: { latitude: -37.8, longitude: 144.98 },
      rating: 4.6,
      userRatingCount: 2103,
      primaryType: "cafe",
      primaryTypeDisplayName: { text: "Cafe" },
      types: ["cafe", "food", "point_of_interest"],
      priceLevel: "PRICE_LEVEL_MODERATE",
      editorialSummary: { text: "Specialty coffee roaster with all-day brunch." },
      googleMapsUri: "https://maps.google.com/?cid=1",
      websiteUri: "https://proudmarycoffee.com.au",
      photos: [{ name: "places/place-1/photos/abc123" }],
      currentOpeningHours: { openNow: true },
    },
    {
      id: "place-2",
      displayName: { text: "New Spot" },
      formattedAddress: "1 Smith St, Fitzroy VIC",
      location: { latitude: -37.79, longitude: 144.97 },
      types: ["cafe"],
      // No rating, no userRatingCount, no priceLevel, no photos, no summary,
      // no maps/website URIs, no opening hours -- everything optional.
    },
  ],
};

const EXPECTED_MAPPED = [
  {
    id: "place-1",
    name: "Proud Mary Coffee",
    address: "172 Oxford St, Collingwood VIC",
    lat: -37.8,
    lng: 144.98,
    rating: 4.6,
    ratingCount: 2103,
    type: "Cafe",
    primaryType: "cafe",
    types: ["cafe", "food", "point_of_interest"],
    priceLevel: "PRICE_LEVEL_MODERATE",
    summary: "Specialty coffee roaster with all-day brunch.",
    mapsUri: "https://maps.google.com/?cid=1",
    websiteUri: "https://proudmarycoffee.com.au",
    photoName: "places/place-1/photos/abc123",
    openNow: true,
  },
  {
    id: "place-2",
    name: "New Spot",
    address: "1 Smith St, Fitzroy VIC",
    lat: -37.79,
    lng: 144.97,
    rating: null,
    ratingCount: null,
    type: null,
    primaryType: null,
    types: ["cafe"],
    priceLevel: null,
    summary: null,
    mapsUri: null,
    websiteUri: null,
    photoName: null,
    openNow: null,
  },
];

let fetchMock: ReturnType<typeof vi.fn>;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  process.env.GOOGLE_MAPS_SERVER_KEY = API_KEY;
  fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(RAW_RESPONSE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  delete process.env.GOOGLE_MAPS_SERVER_KEY;
});

test("searchNearby sends the exact field mask and maps the response", async () => {
  const t = convexTest(schema, modules);

  const result = await t.withIdentity({ subject: "u1" }).action(api.places.searchNearby, {
    lat: -37.8136,
    lng: 144.9631,
    radiusKm: 2,
    includedTypes: ["cafe"],
  });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe("https://places.googleapis.com/v1/places:searchNearby");
  expect(init.headers["X-Goog-FieldMask"]).toBe(EXPECTED_FIELD_MASK);
  expect(init.headers["X-Goog-Api-Key"]).toBe(API_KEY);

  expect(result.results).toEqual(EXPECTED_MAPPED);
});

test("searchText sends the exact field mask and maps the response", async () => {
  const t = convexTest(schema, modules);

  const result = await t.action(internal.places.searchText, {
    query: "Proud Mary Coffee",
    lat: -37.8136,
    lng: 144.9631,
    radiusKm: 2,
  });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe("https://places.googleapis.com/v1/places:searchText");
  expect(init.headers["X-Goog-FieldMask"]).toBe(EXPECTED_FIELD_MASK);
  expect(init.headers["X-Goog-Api-Key"]).toBe(API_KEY);

  const body = JSON.parse(init.body as string);
  expect(body.textQuery).toBe("Proud Mary Coffee");

  expect(result.results).toEqual(EXPECTED_MAPPED);
});

// A missing key is an operator mistake, and the two audiences need different
// things: the person holding the phone needs a sentence they can act on, the
// person running the deployment needs the actual cause. So this pins both.
//
// It used to assert only `expect(fetchMock).not.toHaveBeenCalled()`, which
// proved nothing -- the key is read on the line above the fetch, so no
// arrangement of this code could have called it. The happy-path test above is
// the positive control that the same action does reach Google when configured.
test("searchNearby refuses, and names the missing key in the log, when it is not set", async () => {
  delete process.env.GOOGLE_MAPS_SERVER_KEY;
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const t = convexTest(schema, modules);

  const promise = t
    .withIdentity({ subject: "u1" })
    .action(api.places.searchNearby, { lat: 0, lng: 0, radiusKm: 1 });
  await expect(promise).rejects.toBeInstanceOf(ConvexError);
  await expect(promise).rejects.toMatchObject({
    data: { code: "PLACES_UNAVAILABLE", message: expect.stringMatching(/could not reach/i) },
  });
  // The user-facing sentence must not hand out our configuration.
  await expect(promise).rejects.not.toMatchObject({
    data: { message: expect.stringContaining("GOOGLE_MAPS_SERVER_KEY") },
  });
  expect(warn.mock.calls.flat().join(" ")).toMatch(/GOOGLE_MAPS_SERVER_KEY is not set/);
});

// searchNearby is the one Places action the browser may call, and it proxies
// our billed Google key -- so an anonymous caller must be turned away before
// the key is ever read, let alone spent.
test("searchNearby refuses an anonymous caller", async () => {
  const t = convexTest(schema, modules);

  const promise = t.action(api.places.searchNearby, { lat: 0, lng: 0, radiusKm: 1 });
  await expect(promise).rejects.toBeInstanceOf(ConvexError);
  await expect(promise).rejects.toMatchObject({ data: { code: "NOT_SIGNED_IN" } });
  expect(fetchMock).not.toHaveBeenCalled();
});

// The whole point of the photo route: our billed key is spendable by anyone who
// can read it, and a PlaceResult is returned to browsers AND persisted into
// `quests`. A direct string search over the serialised value is the assertion,
// because it holds no matter how the shape is refactored later.
test("no PlaceResult carries the Google key in any field", async () => {
  const t = convexTest(schema, modules);

  const result = await t.withIdentity({ subject: "u1" }).action(api.places.searchNearby, {
    lat: -37.8136,
    lng: 144.9631,
    radiusKm: 2,
  });

  expect(JSON.stringify(result)).not.toContain(API_KEY);
  expect(JSON.stringify(result)).not.toContain("key=");
  expect(result.results[0].photoName).toBe("places/place-1/photos/abc123");
});

test("the photo route attaches the key server-side and redirects to Google", async () => {
  const t = convexTest(schema, modules);
  fetchMock.mockImplementation(
    async () =>
      new Response(JSON.stringify({ photoUri: "https://lh3.googleusercontent.com/signed-and-keyless" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );

  const response = await t.fetch("/places/photo?name=places/place-1/photos/abc123");

  expect(response.status).toBe(302);
  const location = response.headers.get("Location")!;
  expect(location).toBe("https://lh3.googleusercontent.com/signed-and-keyless");
  // Google's signed URL is what the browser sees, and it is not ours to leak.
  expect(location).not.toContain(API_KEY);

  // Our key went to Google in a header, never in the URL -- a URL is logged,
  // cached and handed back in redirects; a header is not.
  const [url, init] = fetchMock.mock.calls[0];
  expect(String(url)).not.toContain(API_KEY);
  expect(String(url)).toContain("skipHttpRedirect=true");
  expect((init.headers as Record<string, string>)["X-Goog-Api-Key"]).toBe(API_KEY);
});

test("the photo route refuses anything that is not a Places photo reference", async () => {
  const t = convexTest(schema, modules);

  for (const name of [
    "",
    "../../v1/places:searchText",
    "places/x/photos/y/../../../other",
    "https://places.googleapis.com/v1/places/x/photos/y",
    "places/x/photos/y?key=stolen",
  ]) {
    const response = await t.fetch(`/places/photo?name=${encodeURIComponent(name)}`);
    expect(response.status).toBe(400);
  }
  // Never reached Google, so never spent the key.
  expect(fetchMock).not.toHaveBeenCalled();
});

test("the photo route will not redirect anywhere but Google", async () => {
  const t = convexTest(schema, modules);
  fetchMock.mockImplementation(
    async () =>
      new Response(JSON.stringify({ photoUri: "https://evil.example.com/pixel.png" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );

  // A public GET on our own domain must not become an open redirect, whatever
  // the upstream body says.
  const response = await t.fetch("/places/photo?name=places/place-1/photos/abc123");
  expect(response.status).toBe(502);
  expect(response.headers.get("Location")).toBeNull();
});

// 503 and a plain sentence -- an <img> that cannot load is not something the
// viewer can fix, and the response must not leak which key is missing.
// (The old `not.toHaveBeenCalled()` here was unfalsifiable: the key is read
// before the fetch, so it could never have fired. The redirect test above is
// the positive control that this route does call Google when configured.)
test("the photo route reports missing configuration rather than throwing", async () => {
  delete process.env.GOOGLE_MAPS_SERVER_KEY;
  const t = convexTest(schema, modules);

  const response = await t.fetch("/places/photo?name=places/place-1/photos/abc123");
  expect(response.status).toBe(503);
  expect(response.headers.get("Location")).toBeNull();
  const body = await response.text();
  expect(body).not.toMatch(/GOOGLE_MAPS_SERVER_KEY/);
  expect(body).toMatch(/not configured/i);
});
