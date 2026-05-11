import { useMemo } from "react";

import type { ParsedBuilding } from "./cityjsonMesh";

const HIT_RADIUS_M = 30;

/**
 * Pick the building whose lat/lng centroid is closest to `mouse`, capped
 * at HIT_RADIUS_M so a hover over open ground returns null. The pool is
 * a few thousand buildings max, so a linear scan at 60 Hz is fine.
 */
export function useHoveredBuilding(
  buildings: ParsedBuilding[],
  mouse: { lat: number; lng: number } | null,
): ParsedBuilding | null {
  return useMemo(() => {
    if (!mouse || buildings.length === 0) return null;
    const latRad = (mouse.lat * Math.PI) / 180;
    const mPerDegLat = 111_320;
    const mPerDegLng = mPerDegLat * Math.cos(latRad);
    let best: ParsedBuilding | null = null;
    let bestSqM = HIT_RADIUS_M * HIT_RADIUS_M;
    for (const b of buildings) {
      const dx = (b.lng - mouse.lng) * mPerDegLng;
      const dy = (b.lat - mouse.lat) * mPerDegLat;
      const sqM = dx * dx + dy * dy;
      if (sqM < bestSqM) {
        best = b;
        bestSqM = sqM;
      }
    }
    return best;
  }, [buildings, mouse]);
}
