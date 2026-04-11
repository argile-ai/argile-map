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
 * Hash the bounds down to ~10 m so small pans reuse the same cache entry
 * instead of re-fetching. Also used as the TanStack Query cache key.
 */
function boundsKey(b: Bounds): string {
  const r = (n: number) => Math.round(n * 1e4) / 1e4;
  return `${r(b.minLat)}|${r(b.maxLat)}|${r(b.minLng)}|${r(b.maxLng)}`;
}

export function useViewportBuildings(bounds: Bounds | null): CityJsonBuilding[] {
  useEffect(() => {
    if (!bounds) {
      // Panning below the zoom gate or during initial mount — clear the
      // visible set so the map doesn't keep stale buildings off-screen.
      setViewportBuildings([]);
      return;
    }

    let cancelled = false;
    setViewportLoading();

    const timer = setTimeout(() => {
      queryClient
        .fetchQuery({
          queryKey: ["viewport", boundsKey(bounds)],
          queryFn: ({ signal }) => searchBuildingsInBounds({ bounds, signal }),
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
  }, [bounds]);

  const { data } = useLiveQuery((q) => q.from({ b: buildingsCollection }));
  // biome-ignore lint/suspicious/noExplicitAny: useLiveQuery infers the row type.
  return (data as any) ?? [];
}
