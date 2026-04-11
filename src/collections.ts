/**
 * Reactive building store.
 *
 * Architecture:
 *   ┌──────────────┐   fetch-per-tile   ┌──────────────────────┐
 *   │ TanStack     │ ◄───────────────── │ useVisibleTiles      │
 *   │ Query cache  │   (queryClient)    │ (viewport → tileIds) │
 *   └──────┬───────┘                    └──────────────────────┘
 *          │ on each resolved tile
 *          ▼ writeInsert()
 *   ┌──────────────────────────┐    useLiveQuery     ┌──────────────┐
 *   │ buildingsCollection      │ ◄──────────────────▶│ <App/> render│
 *   │ (local-only, reactive)   │                     └──────────────┘
 *   └──────────────────────────┘
 *
 * There is exactly ONE TanStack DB collection — the unified set of every
 * building ever fetched in the current session. Per-tile TanStack Query
 * handles network caching / deduplication; as each tile resolves we
 * `writeInsert` its buildings into the collection. The collection's reactive
 * `useLiveQuery` drives the deck.gl layer.
 */

import { createCollection, localOnlyCollectionOptions } from "@tanstack/react-db";
import { QueryClient } from "@tanstack/query-core";
import { searchBuildingsByRadius } from "./api";
import type { Tile, TileId } from "./tiles";
import type { CityJsonBuilding } from "./types";

/** TanStack Query client used as a per-tile HTTP cache. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: 1000 * 60 * 30,
      retry: 1,
    },
  },
});

/**
 * The single source of truth for rendered buildings. Local-only, so it
 * doesn't round-trip data through TanStack Query — we feed it via
 * `writeInsert` from our own fetcher.
 */
export const buildingsCollection = createCollection(
  localOnlyCollectionOptions<CityJsonBuilding, string>({
    id: "buildings",
    getKey: (b) => b.geopf_id,
  }),
);

/** Remember which tile each building came from, so we can evict by tile. */
const tileMembership = new Map<TileId, Set<string>>();

/**
 * Live tile-state map driven by loadTile/pruneTiles. Components can
 * subscribe via `subscribeTileStatus` to render loading/error UI.
 */
export type TileStatus = "pending" | "ready" | "error";
const tileStatus = new Map<TileId, TileStatus>();
const tileStatusListeners = new Set<() => void>();

function notifyTileStatus(): void {
  for (const l of tileStatusListeners) l();
}

export function getTileStatusSnapshot(): ReadonlyMap<TileId, TileStatus> {
  return tileStatus;
}

export function subscribeTileStatus(listener: () => void): () => void {
  tileStatusListeners.add(listener);
  return () => {
    tileStatusListeners.delete(listener);
  };
}

/**
 * Fetch a tile (deduplicated via TanStack Query), then push its buildings
 * into the collection. Idempotent: fetching the same tile twice only inserts
 * new buildings once, and writeInsert is a no-op for existing keys.
 */
export async function loadTile(tile: Tile, signal?: AbortSignal): Promise<void> {
  if (tileMembership.has(tile.id)) return;

  tileStatus.set(tile.id, "pending");
  notifyTileStatus();

  let buildings: CityJsonBuilding[];
  try {
    buildings = await queryClient.fetchQuery({
      queryKey: ["tile", tile.id],
      queryFn: ({ signal: qSignal }) =>
        searchBuildingsByRadius({
          lat: tile.lat,
          lng: tile.lng,
          radiusM: tile.radiusM,
          // 10k lets a dense Paris tile land without silent truncation. The
          // backend enforces its own upper bound via MAX_RADIUS_M / query limit.
          limit: 10_000,
          signal: qSignal ?? signal,
        }),
    });
  } catch (err) {
    tileStatus.set(tile.id, "error");
    notifyTileStatus();
    throw err;
  }

  const keys = new Set<string>();
  for (const b of buildings) {
    keys.add(b.geopf_id);
    // Skip inserts for buildings already present — a building that spills
    // into two adjacent tiles is inserted once. local-only collections throw
    // on duplicate keys, so we check `.has()` first.
    if (!buildingsCollection.has(b.geopf_id)) {
      buildingsCollection.insert(b);
    }
  }
  tileMembership.set(tile.id, keys);
  tileStatus.set(tile.id, "ready");
  notifyTileStatus();
}

/**
 * Drop tiles that fell outside the viewport. Buildings unique to those tiles
 * are removed from the collection; buildings also owned by a visible tile
 * stay (they're re-inserted on first load via `loadTile`).
 */
export function pruneTiles(keep: Set<TileId>): void {
  const keptKeys = new Set<string>();
  for (const [tileId, keys] of tileMembership) {
    if (keep.has(tileId)) {
      for (const k of keys) keptKeys.add(k);
    }
  }
  const toDelete: string[] = [];
  for (const [tileId, keys] of tileMembership) {
    if (keep.has(tileId)) continue;
    for (const k of keys) {
      if (!keptKeys.has(k)) toDelete.push(k);
    }
    tileMembership.delete(tileId);
  }
  for (const k of toDelete) {
    if (buildingsCollection.has(k)) buildingsCollection.delete(k);
  }
  let statusChanged = false;
  for (const tileId of [...tileStatus.keys()]) {
    if (!keep.has(tileId)) {
      tileStatus.delete(tileId);
      statusChanged = true;
    }
  }
  if (statusChanged) notifyTileStatus();
}
