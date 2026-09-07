import { v } from "convex/values";
import { action, httpAction, internalAction } from "./_generated/server";
import { requireUserId } from "./lib/access";
import { throwUserError } from "./lib/errors";

const PLACES_ENDPOINT = "https://places.googleapis.com/v1/places:searchNearby";

/**
 * How long we wait on Google before giving up.
 *
 * Without this, a hung socket holds the whole action open until the platform
 * kills it -- and a killed action never reaches its own error handler. That is
 * what stranded a `deck.build` on "building" until STALE_BUILD_MS expired and
 * what stranded a matched room on "Writing the plan..." forever. A bounded
 * failure lands in the caller's `catch`, where there is already a fallback; an
 * unbounded one lands nowhere.
 *
 * Eight seconds is well beyond Places' normal response time, so a timeout here
 * means something is genuinely wrong rather than merely slow.
 */
const PLACES_TIMEOUT_MS = 8_000;

/**
 * Everything Google can do to us, said in a sentence the person can act on.
 *
 * A plain `Error` is redacted to "Server Error" on a production deployment, so
 * a host tapping "Start the deck" during a Google outage was told nothing at
 * all -- while the room had already been handed back to the lobby underneath
 * them, which is exactly the thing they needed to know.
 */
function throwPlacesUnavailable(detail: string): never {
  console.warn(`places: ${detail}`);
  throwUserError(
    "PLACES_UNAVAILABLE",
    "We could not reach the venue search just now. Give it a moment and try again.",
  );
}

// Places API (New) rejects a radius above this.
const MAX_RADIUS_METERS = 50_000;

// The field mask sets the billing SKU, so it asks for exactly what a card
// renders and nothing else. Photos and price level are what make a Places
// result swipeable at all -- without them a card is a name and an address.
// `primaryType` (the raw enum, e.g. "cafe") is what the deck builder matches
// against the room's mood; `primaryTypeDisplayName` is only for humans.
const FIELD_MASK = [
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

const PHOTO_MAX_PX = 800;

/**
 * Google's own photo references, and nothing else. The route below interpolates
 * this straight into a googleapis.com path, so anything that could carry a
 * slash, a dot-dot or an escape would turn our key into a general-purpose proxy
 * onto every Google API it is entitled to call.
 */
const PHOTO_NAME = /^places\/[A-Za-z0-9_.~-]{1,256}\/photos\/[A-Za-z0-9_.~=-]{1,512}$/;

type RawPlace = {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  rating?: number;
  userRatingCount?: number;
  primaryType?: string;
  primaryTypeDisplayName?: { text?: string };
  types?: string[];
  priceLevel?: string;
  editorialSummary?: { text?: string };
  googleMapsUri?: string;
  websiteUri?: string;
  photos?: Array<{ name: string }>;
  currentOpeningHours?: { openNow?: boolean };
};

type PlacesResponse = { places?: RawPlace[] };

export type PlaceResult = {
  id: string;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  ratingCount: number | null;
  type: string | null;
  primaryType: string | null;
  types: string[];
  priceLevel: string | null;
  summary: string | null;
  mapsUri: string | null;
  websiteUri: string | null;
  /**
   * Google's opaque photo reference, e.g. "places/ChIJ.../photos/AeJ...". NOT a
   * URL: a client renders it by asking our own photo route for it, so our key
   * stays here and a rotated key never invalidates a stored row.
   */
  photoName: string | null;
  openNow: boolean | null;
};

// Mirrors PlaceResult exactly, for use as a `returns` validator on both actions.
const placeResultValidator = v.object({
  id: v.string(),
  name: v.string(),
  address: v.string(),
  lat: v.union(v.number(), v.null()),
  lng: v.union(v.number(), v.null()),
  rating: v.union(v.number(), v.null()),
  ratingCount: v.union(v.number(), v.null()),
  type: v.union(v.string(), v.null()),
  primaryType: v.union(v.string(), v.null()),
  types: v.array(v.string()),
  priceLevel: v.union(v.string(), v.null()),
  summary: v.union(v.string(), v.null()),
  mapsUri: v.union(v.string(), v.null()),
  websiteUri: v.union(v.string(), v.null()),
  photoName: v.union(v.string(), v.null()),
  openNow: v.union(v.boolean(), v.null()),
});

/**
 * One mapping, used by both endpoints, so the two can never drift apart.
 *
 * It deliberately returns Google's photo *name* rather than a media URL. The
 * media URL carries the API key as a query parameter, and this value is
 * returned to browsers and persisted into `quests` -- so building one here
 * would hand our billed key to every client and bake it into stored rows,
 * where rotating it would silently break every deck already built.
 */
function mapPlace(place: RawPlace): PlaceResult {
  return {
    id: place.id,
    name: place.displayName?.text ?? "Unnamed place",
    address: place.formattedAddress ?? "",
    lat: place.location?.latitude ?? null,
    lng: place.location?.longitude ?? null,
    rating: place.rating ?? null,
    ratingCount: place.userRatingCount ?? null,
    type: place.primaryTypeDisplayName?.text ?? null,
    primaryType: place.primaryType ?? null,
    types: place.types ?? [],
    priceLevel: place.priceLevel ?? null,
    summary: place.editorialSummary?.text ?? null,
    mapsUri: place.googleMapsUri ?? null,
    websiteUri: place.websiteUri ?? null,
    photoName: place.photos?.[0]?.name ?? null,
    openNow: place.currentOpeningHours?.openNow ?? null,
  };
}

/**
 * The nearby search itself. A local helper, not a Convex function, so the two
 * registrations below share one implementation and can never drift -- and so
 * the internal caller does not have to satisfy the public one's auth model.
 */
async function nearby(args: {
  lat: number;
  lng: number;
  radiusKm: number;
  includedTypes?: string[];
  maxResults?: number;
}): Promise<{ radiusMeters: number; results: PlaceResult[] }> {
  const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!apiKey) {
    // Configuration, not the user's doing -- but they are the one staring at a
    // stuck screen, so they get a sentence rather than "Server Error". The
    // operator gets the actual instruction in the logs.
    throwPlacesUnavailable(
      "GOOGLE_MAPS_SERVER_KEY is not set. Run: npx convex env set GOOGLE_MAPS_SERVER_KEY <key>",
    );
  }

  const radiusMeters = Math.min(Math.max(args.radiusKm, 0.001) * 1000, MAX_RADIUS_METERS);

  let response: Response;
  try {
    response = await fetch(PLACES_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({
        includedTypes: args.includedTypes ?? ["cafe"],
        maxResultCount: Math.min(args.maxResults ?? 10, 20),
        rankPreference: "DISTANCE",
        locationRestriction: {
          circle: {
            center: { latitude: args.lat, longitude: args.lng },
            radius: radiusMeters,
          },
        },
      }),
      signal: AbortSignal.timeout(PLACES_TIMEOUT_MS),
    });
  } catch (error) {
    // A timeout or a transport failure. Same sentence as a 5xx: from where the
    // group is sitting, "Google did not answer" and "Google answered badly" are
    // the same event and have the same remedy.
    throwPlacesUnavailable(`nearby search failed or timed out: ${String(error)}`);
  }

  if (!response.ok) {
    throwPlacesUnavailable(`Places API ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as PlacesResponse;
  return { radiusMeters, results: (data.places ?? []).map((place) => mapPlace(place)) };
}

const nearbyArgs = {
  lat: v.number(),
  lng: v.number(),
  radiusKm: v.number(),
  includedTypes: v.optional(v.array(v.string())),
  maxResults: v.optional(v.number()),
};

const nearbyReturns = v.object({
  radiusMeters: v.number(),
  results: v.array(placeResultValidator),
});

/**
 * Nearby venue search. Runs server-side in Convex so GOOGLE_MAPS_SERVER_KEY
 * never reaches the browser: it is read in `nearby` above, sent to Google in a
 * request header, and never copied into any value returned to a caller or
 * written to the database. Photos come back as opaque names, fetched later
 * through `/places/photo` in convex/http.ts. The browser key is a separate,
 * referrer-locked key used only by the map widget.
 *
 * Public, but signed-in only -- it spends our Google quota.
 */
export const searchNearby = action({
  args: nearbyArgs,
  returns: nearbyReturns,
  handler: async (ctx, args): Promise<{ radiusMeters: number; results: PlaceResult[] }> => {
    // This action proxies our billed Google key. Without a signed-in caller,
    // anyone holding the deployment URL could drain the quota.
    await requireUserId(ctx);
    return await nearby(args);
  },
});

/**
 * The same search for server-side callers. The deck builder authorises by
 * `sessionKey` capability, so routing it through the public action would make
 * a deck build fail for a host whose auth token had expired -- two auth models
 * crossing for no reason.
 */
export const searchNearbyInternal = internalAction({
  args: nearbyArgs,
  returns: nearbyReturns,
  handler: async (_ctx, args): Promise<{ radiusMeters: number; results: PlaceResult[] }> =>
    await nearby(args),
});

const TEXT_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";

/**
 * Backs "pick it yourself" when someone already has a venue in mind. Internal:
 * every caller is server-side, and a public action here would be an
 * unauthenticated proxy onto our billed Google key.
 */
export const searchText = internalAction({
  args: { query: v.string(), lat: v.number(), lng: v.number(), radiusKm: v.number() },
  returns: v.object({ results: v.array(placeResultValidator) }),
  handler: async (_ctx, args): Promise<{ results: PlaceResult[] }> => {
    const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY;
    if (!apiKey) throwPlacesUnavailable("GOOGLE_MAPS_SERVER_KEY is not set.");

    let response: Response;
    try {
      response = await fetch(TEXT_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": FIELD_MASK,
        },
        body: JSON.stringify({
          textQuery: args.query,
          maxResultCount: 8,
          locationBias: {
            circle: {
              center: { latitude: args.lat, longitude: args.lng },
              radius: Math.min(Math.max(args.radiusKm, 0.001) * 1000, MAX_RADIUS_METERS),
            },
          },
        }),
        signal: AbortSignal.timeout(PLACES_TIMEOUT_MS),
      });
    } catch (error) {
      throwPlacesUnavailable(`text search failed or timed out: ${String(error)}`);
    }

    if (!response.ok) {
      throwPlacesUnavailable(`Places text search ${response.status}: ${await response.text()}`);
    }

    const data = (await response.json()) as PlacesResponse;
    return { results: (data.places ?? []).map((place) => mapPlace(place)) };
  },
});

/**
 * The photo route: our own endpoint, standing where a key-bearing Google URL
 * used to. A card holds an opaque photo *name*; the browser asks us for it; we
 * attach the key here, ask Google for a signed, time-limited media URL
 * (`skipHttpRedirect` -- so the key stays out of the redirect it would
 * otherwise hand back), and send the browser there.
 *
 * The consequence that matters: the key exists only in this deployment's
 * environment. Nothing rendered, returned or stored contains it, so rotating it
 * takes effect on the next request and invalidates no stored deck.
 *
 * Unauthenticated by necessity -- an `<img>` tag carries no session -- so the
 * name is validated to a Places photo reference before it is used. That bounds
 * the worst case to fetching a Places photo, rather than to spending the key on
 * whatever else it can reach.
 */
function isGooglePhotoUri(uri: string): boolean {
  // The response body decides where a browser gets sent, so it is checked
  // rather than trusted. Nothing here should ever fail this -- which is the
  // point: a public GET on our own domain must not become an open redirect
  // the day something upstream returns a surprise.
  try {
    const target = new URL(uri);
    return (
      target.protocol === "https:" &&
      (target.hostname.endsWith(".googleusercontent.com") ||
        target.hostname.endsWith(".googleapis.com"))
    );
  } catch {
    return false;
  }
}

export const photo = httpAction(async (_ctx, request) => {
  const url = new URL(request.url);
  const name = url.searchParams.get("name") ?? "";
  if (!PHOTO_NAME.test(name)) {
    return new Response("Not a Places photo reference.", { status: 400 });
  }

  const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY;
  // 503, not 500: the deployment is missing configuration, and a card without
  // a photo is a card, not an error the viewer can do anything about.
  if (!apiKey) return new Response("Photos are not configured.", { status: 503 });

  const requested = Number(url.searchParams.get("maxWidthPx"));
  const maxWidthPx =
    Number.isFinite(requested) && requested > 0 ? Math.min(Math.round(requested), PHOTO_MAX_PX) : PHOTO_MAX_PX;

  // Bounded like every other outbound call: this one is served straight into an
  // <img> tag, so a hung upstream is a card that never finishes loading.
  let response: Response;
  try {
    response = await fetch(
      `https://places.googleapis.com/v1/${name}/media?maxWidthPx=${maxWidthPx}&skipHttpRedirect=true`,
      { headers: { "X-Goog-Api-Key": apiKey }, signal: AbortSignal.timeout(PLACES_TIMEOUT_MS) },
    );
  } catch {
    return new Response("Photo unavailable.", { status: 502 });
  }
  if (!response.ok) return new Response("Photo unavailable.", { status: 502 });

  const { photoUri } = (await response.json()) as { photoUri?: string };
  if (!photoUri || !isGooglePhotoUri(photoUri)) {
    return new Response("Photo unavailable.", { status: 502 });
  }

  // photoUri is Google's own signed, expiring URL. It carries no key of ours.
  return new Response(null, {
    status: 302,
    headers: { Location: photoUri, "Cache-Control": "public, max-age=3600" },
  });
});
