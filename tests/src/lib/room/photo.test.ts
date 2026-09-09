/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { registerComponents } from "../../../convex/testHelpers";
// Relative, not the `@convex/*` alias: vitest resolves through vite, which
// does not read tsconfig `paths`.
import schema from "../../../../convex/schema";
import { PHOTO_MAX_WIDTH_PX, photoPath, photoSrc } from "../../../../src/lib/room/photo";

/**
 * The seam `tsc` cannot check, checked.
 *
 * `photoPath` builds a query string in `src/`; `convex/places.ts`'s photo
 * `httpAction` reads it back with `url.searchParams.get(...)` and no validator
 * -- an `httpAction` takes a raw `Request`, so there is nothing for the type
 * system to line up. These tests drive the REAL handler, through the real
 * router, with a request built by the real client-side function. Rename the
 * `name` parameter on either side alone and this file goes red instead of every
 * deck card silently losing its picture in production.
 */

// convex-test derives each function's public path from the glob's KEYS, and it
// expects them relative to `convex/` -- which is what they are when the glob
// runs from inside that directory. This one runs from `src/lib`, so the prefix
// is rewritten back to what an in-convex glob would have produced.
const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../../../../convex/**/*.ts")).map(([path, load]) => [
    path.replace("../../../convex/", "./"),
    load,
  ]),
);

const API_KEY = "test-google-maps-key";
const PHOTO_NAME = "places/place-1/photos/abc123";
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
      photoName: PHOTO_NAME,
      score: 1,
      scoreBreakdown: { total: 1 },
    });
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("GOOGLE_MAPS_SERVER_KEY", API_KEY);
  fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ photoUri: "https://lh3.googleusercontent.com/signed" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("a path built in the browser is one the deployment's photo route accepts", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  await seedKnownPhoto(t);

  const response = await t.fetch(photoPath(PHOTO_NAME));

  // A 400 here is the handler saying it could not find a photo name where it
  // expected one -- which is exactly what a renamed query parameter looks like.
  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe("https://lh3.googleusercontent.com/signed");
});

test("the width the browser asks for is the width Google is asked for", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  await seedKnownPhoto(t);

  await t.fetch(photoPath(PHOTO_NAME, 400));

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url] = fetchMock.mock.calls[0] as [string];
  expect(url).toContain(`/v1/${PHOTO_NAME}/media`);
  expect(url).toContain("maxWidthPx=400");
});

test("the default width is the route's own ceiling", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  await seedKnownPhoto(t);

  await t.fetch(photoPath(PHOTO_NAME));

  const [url] = fetchMock.mock.calls[0] as [string];
  expect(url).toContain(`maxWidthPx=${PHOTO_MAX_WIDTH_PX}`);
});

test("malformed and nonpositive widths are rejected", async () => {
  for (const width of ["0", "-1", "NaN", "Infinity", "oops"]) {
    const t = convexTest(schema, modules);
    registerComponents(t);
    await seedKnownPhoto(t);

    const response = await t.fetch(`/places/photo?name=${encodeURIComponent(PHOTO_NAME)}&maxWidthPx=${width}`);

    expect(response.status).toBe(400);
  }
  expect(fetchMock).not.toHaveBeenCalled();
});

test("oversized widths clamp to the canonical lease key", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  await seedKnownPhoto(t);

  await t.fetch(photoPath(PHOTO_NAME, PHOTO_MAX_WIDTH_PX + 500));

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url] = fetchMock.mock.calls[0] as [string];
  expect(url).toContain(`maxWidthPx=${PHOTO_MAX_WIDTH_PX}`);
});

// The negative control for the two tests above: if a 302 came back regardless
// of what was in the query string, they would prove nothing.
test("a request with the parameter renamed is refused, which is what makes this a test", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);

  const response = await t.fetch(`/places/photo?photo=${encodeURIComponent(PHOTO_NAME)}`);

  expect(response.status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});

/* ------------------------------------------------------------- photoSrc */

test("a partner's own hosted image wins: it is the picture they supplied", () => {
  expect(
    photoSrc({ photoUrl: "https://partner.example/hero.jpg", photoName: PHOTO_NAME }, "https://x.convex.site"),
  ).toBe("https://partner.example/hero.jpg");
});

test("a Places photo goes through our deployment, never straight to Google", () => {
  const src = photoSrc({ photoName: PHOTO_NAME }, "https://x.convex.site");
  expect(src).toBe(`https://x.convex.site${photoPath(PHOTO_NAME)}`);
  expect(src).not.toContain("googleapis.com");
});

test("a photo name is escaped rather than pasted into the query string", () => {
  const src = photoSrc({ photoName: "places/a b/photos/c&d=e" }, "https://x.convex.site");
  expect(src).toContain("name=places%2Fa+b%2Fphotos%2Fc%26d%3De");
});

test("no picture, and no deployment to ask, are both just no picture", () => {
  expect(photoSrc({}, "https://x.convex.site")).toBeNull();
  expect(photoSrc({ photoName: PHOTO_NAME }, undefined)).toBeNull();
});
