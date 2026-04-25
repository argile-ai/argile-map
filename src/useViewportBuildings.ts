/**
 * React hook that loads every building inside the current viewport via ONE
 * polygon query (debounced) and returns them reactively through the live
 * buildingsCollection.
 *
 * Previous versions walked a ~400 m tile grid and fired one request per
 * tile, which at zoom 15 meant ~30 requests per pan. The backend
 * /cityjson/search already supports polygon queries with a 10 km² area
 * cap, which is far more than any reasonable zoom-15 viewport.
 */

import { useLiveQuery } from "@tanstack/react-db";
import { useEffect } from "react";
import { searchBuildingsInBounds } from "./api";
import {
  buildingsCollection,
  queryClient,
  setViewportBuildings,
  setViewportError,
  setViewportLoading,
} from "./collections";
import type { CityJsonBuilding } from "./types";

export type Bounds = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

const DEBOUNCE_MS = 300;

/**
 * Hard cap on the building list per viewport. Marseille at zoom 17 returns
 * 6 000+ buildings (~25 MB cityjson) without a cap — the network alone
 * stalls the page. 2 000 buildings ≈ 8 MB, which the browser can mesh
 * within a frame budget.
 */
const BUILDINGS_HARD_CAP = 2_000;
const BUILDINGS_PER_KM2 = 2_000;

/**
 * Approximate viewport area in km² (Lambert-flat, lat correction for lng).
 * Good enough for sizing — we don't need geodesic precision.
 */
export function areaKm2(b: Bounds): number {
  const latKm = (b.maxLat - b.minLat) * 111.0;
  const lngKm =
    (b.maxLng - b.minLng) * 111.0 * Math.cos((((b.maxLat + b.minLat) / 2) * Math.PI) / 180);
  return Math.max(0.001, latKm * lngKm);
}

/**
 * Cell size (degrees) used to snap viewport bounds to a cache-friendly grid.
 * A pan that stays inside one cell hits the same TanStack cache entry, so
 * the 25 MB Marseille payload is fetched once per cell instead of every
 * 11 m pan. Sized to ~¼ of the typical viewport span at each zoom — small
 * enough that the fetched bbox still mostly matches what's on screen, large
 * enough that micro-pans almost always hit cache.
 */
export function snapCell(zoom: number): number {
  if (zoom >= 18) return 0.0005;
  if (zoom >= 17) return 0.001;
  if (zoom >= 16) return 0.002;
  return 0.005;
}

/**
 * Expand bounds outward to the nearest grid cell so the fetched bbox fully
 * contains the user's viewport. Two pans in the same cell produce identical
 * snapped bounds — same cache key, same server response, full coverage.
 */
export function snapBounds(b: Bounds, cell: number): Bounds {
  return {
    minLat: Math.floor(b.minLat / cell) * cell,
    maxLat: Math.ceil(b.maxLat / cell) * cell,
    minLng: Math.floor(b.minLng / cell) * cell,
    maxLng: Math.ceil(b.maxLng / cell) * cell,
  };
}

function boundsKey(b: Bounds): string {
  // Bounds are pre-snapped, so a fixed precision is enough to disambiguate.
  const r = (n: number) => n.toFixed(5);
  return `${r(b.minLat)}|${r(b.maxLat)}|${r(b.minLng)}|${r(b.maxLng)}`;
}

export function useViewportBuildings(bounds: Bounds | null, zoom = 17): CityJsonBuilding[] {
  useEffect(() => {
    if (!bounds) {
      // Panning below the zoom gate or during initial mount — clear the
      // visible set so the map doesn't keep stale buildings off-screen.
      setViewportBuildings([]);
      return;
    }

    let cancelled = false;
    setViewportLoading();

    const snapped = snapBounds(bounds, snapCell(zoom));
    const limit = Math.min(BUILDINGS_HARD_CAP, Math.ceil(areaKm2(snapped) * BUILDINGS_PER_KM2));

    const timer = setTimeout(() => {
      queryClient
        .fetchQuery({
          queryKey: ["viewport", boundsKey(snapped), limit],
          queryFn: ({ signal }) => searchBuildingsInBounds({ bounds: snapped, limit, signal }),
        })
        .then((rows) => {
          if (cancelled) return;
          setViewportBuildings(rows);
        })
        .catch((err) => {
          if (cancelled || err?.name === "AbortError") return;
          console.warn("viewport buildings fetch failed", err);
          setViewportError(String(err?.message ?? err));
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [bounds, zoom]);

  const { data } = useLiveQuery((q) => q.from({ b: buildingsCollection }));
  // biome-ignore lint/suspicious/noExplicitAny: useLiveQuery infers the row type.
  return (data as any) ?? [];
}
