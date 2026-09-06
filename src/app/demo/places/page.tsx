"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { APIProvider, Map, AdvancedMarker, Pin } from "@vis.gl/react-google-maps";
import { api } from "@convex/_generated/api";
import { Button, ErrorText, Input } from "@/components/ui";
import { MapCircle } from "@/components/MapCircle";

const BROWSER_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ?? "DEMO_MAP_ID";

const PLACE_TYPES = ["cafe", "restaurant", "library", "park", "bar"];

type Place = {
  id: string;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  ratingCount: number | null;
  type: string | null;
};

type Results = { radiusMeters: number; results: Place[] };

export default function PlacesDemoPage() {
  const searchNearby = useAction(api.places.searchNearby);

  const [center, setCenter] = useState({ lat: -34.9285, lng: 138.6007 });
  const [radiusKm, setRadiusKm] = useState(2);
  const [placeType, setPlaceType] = useState("cafe");
  const [data, setData] = useState<Results | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function run() {
    setError(null);
    setPending(true);
    try {
      setData(
        await searchNearby({
          lat: center.lat,
          lng: center.lng,
          radiusKm,
          includedTypes: [placeType],
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  function useMyLocation() {
    navigator.geolocation.getCurrentPosition(
      (pos) => setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => setError(err.message),
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 p-6">
      <div>
        <h1 className="text-xl font-semibold">Places demo</h1>
        <p className="text-sm text-neutral-600">
          Search runs in a Convex action, so the Places key stays server-side. The map below
          uses a separate, referrer-restricted browser key.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          Latitude
          <Input
            type="number"
            step="any"
            value={center.lat}
            onChange={(e) => setCenter((c) => ({ ...c, lat: Number(e.target.value) }))}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Longitude
          <Input
            type="number"
            step="any"
            value={center.lng}
            onChange={(e) => setCenter((c) => ({ ...c, lng: Number(e.target.value) }))}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        Radius: {radiusKm} km
        <input
          type="range"
          min={0.5}
          max={50}
          step={0.5}
          value={radiusKm}
          onChange={(e) => setRadiusKm(Number(e.target.value))}
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={placeType}
          onChange={(e) => setPlaceType(e.target.value)}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
        >
          {PLACE_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <Button onClick={run} disabled={pending}>
          {pending ? "Searching..." : "Search nearby"}
        </Button>
        <Button variant="secondary" onClick={useMyLocation}>
          Use my location
        </Button>
      </div>

      <ErrorText>{error}</ErrorText>

      <div className="h-80 overflow-hidden rounded-md border border-neutral-200">
        {BROWSER_KEY ? (
          <APIProvider apiKey={BROWSER_KEY}>
            <Map
              mapId={MAP_ID}
              defaultCenter={center}
              defaultZoom={13}
              gestureHandling="greedy"
              disableDefaultUI
            >
              <MapCircle center={center} radiusMeters={data?.radiusMeters ?? radiusKm * 1000} />
              {data?.results
                .filter((place) => place.lat !== null && place.lng !== null)
                .map((place) => (
                  <AdvancedMarker
                    key={place.id}
                    position={{ lat: place.lat!, lng: place.lng! }}
                    title={place.name}
                  >
                    <Pin />
                  </AdvancedMarker>
                ))}
            </Map>
          </APIProvider>
        ) : (
          <p className="p-3 text-sm text-neutral-500">
            Set NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY in .env.local to render the map. The
            search above works without it.
          </p>
        )}
      </div>

      <ul className="flex flex-col divide-y divide-neutral-200 rounded-md border border-neutral-200">
        {data?.results.length === 0 && (
          <li className="p-3 text-sm text-neutral-500">No results in that radius.</li>
        )}
        {data?.results.map((place) => (
          <li key={place.id} className="p-3">
            <p className="text-sm font-medium">{place.name}</p>
            <p className="text-xs text-neutral-500">
              {place.type ? `${place.type} - ` : ""}
              {place.address}
              {place.rating ? ` - ${place.rating}/5 (${place.ratingCount})` : ""}
            </p>
          </li>
        ))}
      </ul>
    </main>
  );
}
