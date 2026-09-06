"use client";

import { useEffect, useRef } from "react";
import { useMap } from "@vis.gl/react-google-maps";

/**
 * The library ships no Circle component, so drive the raw overlay directly.
 * Kept in its own file so the imperative bit does not leak into the page.
 */
export function MapCircle({
  center,
  radiusMeters,
}: {
  center: { lat: number; lng: number };
  radiusMeters: number;
}) {
  const map = useMap();
  const circleRef = useRef<google.maps.Circle | null>(null);

  useEffect(() => {
    if (!map) return;
    if (!circleRef.current) {
      circleRef.current = new google.maps.Circle({
        strokeColor: "#171717",
        strokeOpacity: 0.6,
        strokeWeight: 1,
        fillColor: "#171717",
        fillOpacity: 0.06,
      });
    }
    const circle = circleRef.current;
    circle.setOptions({ map, center, radius: radiusMeters });
    map.fitBounds(circle.getBounds()!);

    return () => circle.setMap(null);
  }, [map, center, radiusMeters]);

  return null;
}
