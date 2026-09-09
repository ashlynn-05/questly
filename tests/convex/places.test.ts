/// <reference types="vite/client" />
import { registerComponents } from "./testHelpers";
import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { rateLimiter } from "../../convex/lib/rateLimits";

const modules = import.meta.glob("../../convex/**/*.ts");

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
type T = TestConvex<typeof schema>;

async function seedKnownPhoto(t: T): Promise<void> {
  await t.run(async (ctx) => {
    const roomId = await ctx.db.insert("rooms", {
      hostUserId: "photo-owner",
      mood: "grass",
      headcount: 2,
      budgetPerHeadCents: 2_000,
      whenAt: Date.now() + 3_600_000,
      centreLat: -37.8,
      centreLng: 144.96,
      radiusKm: 5,
      visibility: "private",
      status: "swiping",
      code: "PHOTO",
    });
    await ctx.db.insert("quests", {
      roomId,
      rank: 0,
      source: "places",
      placeId: "place-1",
      title: "Proud Mary Coffee",
      blurb: "Coffee",
      priceLabel: "$20",
      priceCents: 2_000,
      distanceKm: 1,
      discountPct: 0,
      photoName: "places/place-1/photos/abc123",
      score: 1,
      scoreBreakdown: { total: 1 },
    });
  });
}

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
  registerComponents(t);

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
  registerComponents(t);

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
  registerComponents(t);

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
  registerComponents(t);

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
  registerComponents(t);

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
  registerComponents(t);
  await seedKnownPhoto(t);
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
  expect(response.headers.get("Cache-Control")).toBe("no-store");
});

test("same-isolate photo requests coalesce one physical Google resolution", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  await seedKnownPhoto(t);
  let release: (() => void) | undefined;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  fetchMock.mockImplementation(async () => {
    await waiting;
    return new Response(JSON.stringify({ photoUri: "https://lh3.googleusercontent.com/coalesced" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  const first = t.fetch("/places/photo?name=places/place-1/photos/abc123");
  const second = t.fetch("/places/photo?name=places/place-1/photos/abc123");
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  release!();
  const responses = await Promise.all([first, second]);

  expect(responses.map((response) => response.status)).toEqual([302, 302]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("photo resolution has no settled content cache and keys different widths separately", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  await seedKnownPhoto(t);

  await t.fetch("/places/photo?name=places/place-1/photos/abc123&maxWidthPx=400");
  await t.fetch("/places/photo?name=places/place-1/photos/abc123&maxWidthPx=400");
  await t.fetch("/places/photo?name=places/place-1/photos/abc123&maxWidthPx=800");

  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(String(fetchMock.mock.calls[0][0])).toContain("maxWidthPx=400");
  expect(String(fetchMock.mock.calls[1][0])).toContain("maxWidthPx=400");
  expect(String(fetchMock.mock.calls[2][0])).toContain("maxWidthPx=800");
});

test("photo provider denial is 429 while quota-store failure is 503", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  await seedKnownPhoto(t);

  for (let count = 0; count < 120; count++) {
    await t.mutation(internal.rateLimits.reserveProvider, { provider: "google" });
  }
  const denied = await t.fetch("/places/photo?name=places/place-1/photos/abc123");
  expect(denied.status).toBe(429);
  expect(denied.headers.get("Retry-After")).toMatch(/^[1-9]/);
  expect(fetchMock).not.toHaveBeenCalled();

  const limit = vi.spyOn(rateLimiter, "limit").mockRejectedValue(new Error("store unavailable"));
  try {
    const unavailable = await t.fetch("/places/photo?name=places/place-1/photos/abc123");
    expect(unavailable.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  } finally {
    limit.mockRestore();
  }
});

test("a timed-out photo attempt keeps its provider reservation", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  await seedKnownPhoto(t);
  for (let count = 0; count < 119; count++) {
    await t.mutation(internal.rateLimits.reserveProvider, { provider: "google" });
  }
  fetchMock.mockRejectedValue(new Error("upstream timeout"));

  const timedOut = await t.fetch("/places/photo?name=places/place-1/photos/abc123");
  expect(timedOut.status).toBe(502);
  expect(fetchMock).toHaveBeenCalledTimes(1);

  const denied = await t.fetch("/places/photo?name=places/place-1/photos/abc123");
  expect(denied.status).toBe(429);
  // The denied retry never reached Google, proving the timeout did not refund
  // the physical attempt it had already admitted.
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("photo leases reclaim expired rows without deleting a successor", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const first = await t.mutation(internal.places.acquirePhotoLease, {
    key: "hashed-photo-key",
    token: "first",
    now: 100,
    expiresAt: 200,
  });
  expect(first).toBe(true);
  expect(
    await t.mutation(internal.places.acquirePhotoLease, {
      key: "hashed-photo-key",
      token: "busy",
      now: 150,
      expiresAt: 250,
    }),
  ).toBe(false);
  expect(
    await t.mutation(internal.places.acquirePhotoLease, {
      key: "hashed-photo-key",
      token: "successor",
      now: 201,
      expiresAt: 301,
    }),
  ).toBe(true);

  await t.mutation(internal.places.releasePhotoLease, { key: "hashed-photo-key", token: "first" });
  const successor = await t.run(async (ctx) =>
    ctx.db.query("photoLeases").withIndex("by_key", (q) => q.eq("key", "hashed-photo-key")).first(),
  );
  expect(successor).toMatchObject({ token: "successor", expiresAt: 301 });
  expect(JSON.stringify(successor)).not.toContain("places/");
  await t.mutation(internal.places.releasePhotoLease, { key: "hashed-photo-key", token: "successor" });
  expect(await t.run(async (ctx) => ctx.db.query("photoLeases").collect())).toHaveLength(0);
});

test("the photo route refuses anything that is not a Places photo reference", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);

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
  registerComponents(t);
  await seedKnownPhoto(t);
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

test("expired and timed-out upstream photos map to 404 and 502", async () => {
  const expired = convexTest(schema, modules);
  registerComponents(expired);
  await seedKnownPhoto(expired);
  fetchMock.mockResolvedValueOnce(new Response("expired", { status: 404 }));
  expect((await expired.fetch("/places/photo?name=places/place-1/photos/abc123")).status).toBe(404);

  const timedOut = convexTest(schema, modules);
  registerComponents(timedOut);
  await seedKnownPhoto(timedOut);
  fetchMock.mockRejectedValueOnce(new Error("timeout"));
  expect((await timedOut.fetch("/places/photo?name=places/place-1/photos/abc123")).status).toBe(502);
});

// 503 and a plain sentence -- an <img> that cannot load is not something the
// viewer can fix, and the response must not leak which key is missing.
// (The old `not.toHaveBeenCalled()` here was unfalsifiable: the key is read
// before the fetch, so it could never have fired. The redirect test above is
// the positive control that this route does call Google when configured.)
test("the photo route reports missing configuration rather than throwing", async () => {
  delete process.env.GOOGLE_MAPS_SERVER_KEY;
  const t = convexTest(schema, modules);
  registerComponents(t);
  await seedKnownPhoto(t);

  const response = await t.fetch("/places/photo?name=places/place-1/photos/abc123");
  expect(response.status).toBe(503);
  expect(response.headers.get("Location")).toBeNull();
  const body = await response.text();
  expect(body).not.toMatch(/GOOGLE_MAPS_SERVER_KEY/);
  expect(body).toMatch(/not configured/i);
});

test("the photo route rejects a valid but unknown source without spending Google quota", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);

  const response = await t.fetch("/places/photo?name=places/unknown/photos/abc123");

  expect(response.status).toBe(404);
  expect(fetchMock).not.toHaveBeenCalled();
});

test("the photo route rejects invalid widths before looking up an unknown source", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);

  for (const width of ["0", "-1", "NaN", "Infinity"]) {
    const response = await t.fetch(
      `/places/photo?name=places/unknown/photos/abc123&maxWidthPx=${width}`,
    );
    expect(response.status).toBe(400);
  }
  expect(fetchMock).not.toHaveBeenCalled();
});
