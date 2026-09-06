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
    photoUrl: `https://places.googleapis.com/v1/places/place-1/photos/abc123/media?maxWidthPx=800&key=${API_KEY}`,
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
    photoUrl: null,
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

test("searchNearby throws when GOOGLE_MAPS_SERVER_KEY is not set", async () => {
  delete process.env.GOOGLE_MAPS_SERVER_KEY;
  const t = convexTest(schema, modules);

  await expect(
    t.withIdentity({ subject: "u1" }).action(api.places.searchNearby, { lat: 0, lng: 0, radiusKm: 1 }),
  ).rejects.toThrow(/GOOGLE_MAPS_SERVER_KEY is not set/);
  expect(fetchMock).not.toHaveBeenCalled();
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
