/**
 * React hook that returns all buildings visible in the current viewport.
 *
 * Data flow:
 *   viewport bounds → tile grid → TanStack DB collections (one per tile)
 *   → subscribe to each collection → flat array of buildings
 *
 * We use an internal Map<geopf_id, building> and React's useSyncExternalStore
 * to expose a stable reference that only changes when buildings are added or
 * removed. The hook also cleans up non-visible tile collections to free memory.
 */

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { getTileCollection, pruneTileCollections } from "./collections";
import { tilesInBounds } from "./tiles";
import type { CityJsonBuilding } from "./types";

export type Bounds = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

type Snapshot = { buildings: CityJsonBuilding[]; version: number };

export function useViewportBuildings(bounds: Bounds | null): CityJsonBuilding[] {
  const storeRef = useRef<{
    items: Map<string, CityJsonBuilding>;
    snapshot: Snapshot;
    listeners: Set<() => void>;
  }>({
    items: new Map(),
    snapshot: { buildings: [], version: 0 },
    listeners: new Set(),
  });

  const tiles = useMemo(() => (bounds ? tilesInBounds(bounds) : []), [bounds]);
  // Stable string key derived from tile ids to diff effect dependencies.
  const tileKey = useMemo(
    () => tiles.map((t) => t.id).sort().join(","),
    [tiles],
  );

  const bump = (): void => {
    const store = storeRef.current;
    store.snapshot = {
      buildings: [...store.items.values()],
      version: store.snapshot.version + 1,
    };
    for (const listener of store.listeners) listener();
  };

  useEffect(() => {
    const store = storeRef.current;
    const subscriptions = tiles.map((tile) => {
      const collection = getTileCollection(tile);
      return collection.subscribeChanges(
        // biome-ignore lint/suspicious/noExplicitAny: the `any` tile collection
        // widens this change type too.
        (changes: any[]) => {
          for (const change of changes) {
            if (change.type === "delete") {
              store.items.delete(change.key as string);
            } else {
              store.items.set(change.key as string, change.value as CityJsonBuilding);
            }
          }
          bump();
        },
        { includeInitialState: true },
      );
    });

    return () => {
      for (const s of subscriptions) s.unsubscribe();
    };
  }, [tiles]);

  // When the set of visible tiles changes, prune the collections that fell
  // outside and drop their buildings from our aggregated map.
  useEffect(() => {
    const keep = new Set(tiles.map((t) => t.id));
    pruneTileCollections(keep);
    // Remove buildings from tiles no longer visible. We can't know from a
    // building alone which tile it came from, so we rebuild the map by
    // re-subscribing on the next effect tick — here we just mark dirty.
    // In practice, the re-subscribe effect above will receive new initial
    // state for kept tiles. Missing tiles simply won't be re-populated.
    const store = storeRef.current;
    store.items.clear();
    bump();
    // biome-ignore lint/correctness/useExhaustiveDependencies: tileKey is derived from tiles
  }, [tileKey]);

  return useSyncExternalStore(
    (listener) => {
      storeRef.current.listeners.add(listener);
      return () => {
        storeRef.current.listeners.delete(listener);
      };
    },
    () => storeRef.current.snapshot.buildings,
    () => storeRef.current.snapshot.buildings,
  );
}
