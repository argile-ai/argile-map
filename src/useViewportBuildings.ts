/**
 * React hook that returns every building currently loaded in the reactive
 * `buildingsCollection`, filtered to the viewport's tile set. Data flow:
 *
 *   1. Viewport bounds change → recompute visible tile IDs.
 *   2. For each visible tile, kick off `loadTile()` (TanStack Query dedupes).
 *   3. As tiles resolve, they `writeInsert` into `buildingsCollection`.
 *   4. `useLiveQuery` reactively reads the collection and re-renders.
 *   5. Tiles that fall out of view are pruned from the collection.
 */

import { useLiveQuery } from "@tanstack/react-db";
import { useEffect, useMemo } from "react";
import { buildingsCollection, loadTile, pruneTiles } from "./collections";
import { tilesInBounds } from "./tiles";
import type { CityJsonBuilding } from "./types";

export type Bounds = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

export function useViewportBuildings(bounds: Bounds | null): CityJsonBuilding[] {
  const tiles = useMemo(() => (bounds ? tilesInBounds(bounds) : []), [bounds]);
  const tileKey = useMemo(
    () =>
      tiles
        .map((t) => t.id)
        .sort()
        .join(","),
    [tiles],
  );

  useEffect(() => {
    const controller = new AbortController();
    for (const tile of tiles) {
      loadTile(tile, controller.signal).catch((err) => {
        if (err?.name !== "AbortError") console.warn("tile load failed", tile.id, err);
      });
    }
    pruneTiles(new Set(tiles.map((t) => t.id)));
    return () => controller.abort();
    // biome-ignore lint/correctness/useExhaustiveDependencies: tileKey captures `tiles`.
  }, [tileKey]);

  const { data } = useLiveQuery((q) => q.from({ b: buildingsCollection }));
  // biome-ignore lint/suspicious/noExplicitAny: useLiveQuery infers the row type.
  return (data as any) ?? [];
}
