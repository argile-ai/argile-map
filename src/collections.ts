/**
 * TanStack DB: one collection per geo tile. Each collection fetches its
 * buildings on first access via `createCollection(queryCollectionOptions)`.
 *
 * We intentionally create collections lazily (via `getTileCollection`) so that
 * moving the map only spins up new ones for tiles we haven't seen before, and
 * TanStack DB caches the rest.
 */

import { createCollection } from "@tanstack/db";
import { QueryClient } from "@tanstack/query-core";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { searchBuildingsByRadius } from "./api";
import type { Tile, TileId } from "./tiles";
import type { CityJsonBuilding } from "./types";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Tiles rarely change — keep them cached for the session.
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: 1000 * 60 * 30,
      retry: 1,
    },
  },
});

// biome-ignore lint/suspicious/noExplicitAny: the collection type depends on
// the exact options bag, which is awkward to name. We only rely on the subset
// that is shared by every collection (subscribeChanges, cleanup).
type TileCollection = any;

const tileCollections = new Map<TileId, TileCollection>();

export function getTileCollection(tile: Tile): TileCollection {
  const cached = tileCollections.get(tile.id);
  if (cached) return cached;

  const collection = createCollection(
    queryCollectionOptions({
      id: `tile-${tile.id}`,
      queryKey: ["tile", tile.id],
      queryClient,
      getKey: (b: CityJsonBuilding) => b.geopf_id,
      queryFn: async ({ signal }) => {
        const buildings = await searchBuildingsByRadius({
          lat: tile.lat,
          lng: tile.lng,
          radiusM: tile.radiusM,
          // One tile is ~400m across → most city blocks are <300 buildings.
          // 1000 is a safe ceiling; the backend enforces its own upper bound.
          limit: 1000,
          signal,
        });
        return buildings;
      },
    }),
  );
  tileCollections.set(tile.id, collection);
  return collection;
}

/** Drop tile collections that haven't been visible for a while. */
export function pruneTileCollections(keepIds: Set<TileId>): void {
  for (const [id, collection] of tileCollections) {
    if (!keepIds.has(id)) {
      collection.cleanup();
      tileCollections.delete(id);
    }
  }
}
