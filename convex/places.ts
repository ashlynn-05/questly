import { v } from "convex/values";
import { action } from "./_generated/server";

const PLACES_ENDPOINT = "https://places.googleapis.com/v1/places:searchNearby";

// Places API (New) rejects a radius above this.
const MAX_RADIUS_METERS = 50_000;

// The field mask determines the billing SKU -- request only what the UI renders.
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.rating",
  "places.userRatingCount",
  "places.primaryTypeDisplayName",
].join(",");

type PlacesResponse = {
  places?: Array<{
    id: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    location?: { latitude: number; longitude: number };
    rating?: number;
    userRatingCount?: number;
    primaryTypeDisplayName?: { text?: string };
  }>;
};

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
  handler: async (_ctx, args) => {
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
      results: (data.places ?? []).map((place) => ({
        id: place.id,
        name: place.displayName?.text ?? "Unnamed place",
        address: place.formattedAddress ?? "",
        lat: place.location?.latitude ?? null,
        lng: place.location?.longitude ?? null,
        rating: place.rating ?? null,
        ratingCount: place.userRatingCount ?? null,
        type: place.primaryTypeDisplayName?.text ?? null,
      })),
    };
  },
});
