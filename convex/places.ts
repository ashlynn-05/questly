import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { requireUserId } from "./lib/access";

const PLACES_ENDPOINT = "https://places.googleapis.com/v1/places:searchNearby";

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
  photoUrl: string | null;
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
  photoUrl: v.union(v.string(), v.null()),
  openNow: v.union(v.boolean(), v.null()),
});

/**
 * One mapping, used by both endpoints, so the two can never drift apart.
 * The photo URL embeds the server key, so it is a redirect the browser follows
 * -- it is not a secret leak, but it is why photos are proxied through Google
 * rather than fetched here.
 */
function mapPlace(place: RawPlace, apiKey: string): PlaceResult {
  const photoName = place.photos?.[0]?.name;
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
    photoUrl: photoName
      ? `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=${PHOTO_MAX_PX}&key=${apiKey}`
      : null,
    openNow: place.currentOpeningHours?.openNow ?? null,
  };
}

/**
 * Nearby venue search. Runs server-side in Convex so GOOGLE_MAPS_SERVER_KEY
 * never reaches the browser -- the browser key is a separate, referrer-locked key
 * used only by the map widget.
 */
export const searchNearby = action({
  args: {
    lat: v.number(),
    lng: v.number(),
    radiusKm: v.number(),
    includedTypes: v.optional(v.array(v.string())),
    maxResults: v.optional(v.number()),
  },
  returns: v.object({ radiusMeters: v.number(), results: v.array(placeResultValidator) }),
  handler: async (ctx, args) => {
    // This action proxies our billed Google key. Without a signed-in caller,
    // anyone holding the deployment URL could drain the quota.
    await requireUserId(ctx);

    const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY;
    if (!apiKey) {
      throw new Error(
        "GOOGLE_MAPS_SERVER_KEY is not set. Run: npx convex env set GOOGLE_MAPS_SERVER_KEY <key>",
      );
    }

    const radiusMeters = Math.min(Math.max(args.radiusKm, 0.001) * 1000, MAX_RADIUS_METERS);

    const response = await fetch(PLACES_ENDPOINT, {
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
    });

    if (!response.ok) {
      throw new Error(`Places API ${response.status}: ${await response.text()}`);
    }

    const data = (await response.json()) as PlacesResponse;
    return {
      radiusMeters,
      results: (data.places ?? []).map((place) => mapPlace(place, apiKey)),
    };
  },
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
    if (!apiKey) throw new Error("GOOGLE_MAPS_SERVER_KEY is not set.");

    const response = await fetch(TEXT_ENDPOINT, {
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
    });

    if (!response.ok) {
      throw new Error(`Places text search ${response.status}: ${await response.text()}`);
    }

    const data = (await response.json()) as PlacesResponse;
    return { results: (data.places ?? []).map((place) => mapPlace(place, apiKey)) };
  },
});
