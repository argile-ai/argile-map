/**
 * Reactive building store.
 *
 *   ┌──────────────────┐   fetchQuery(bounds)   ┌─────────────────────┐
 *   │ TanStack Query   │ ◄──────────────────── │ useViewportBuildings│
 *   │ cache (by bbox)  │                        └─────────────────────┘
 *   └──────┬───────────┘
 *          │ on each resolved bounds
 *          ▼ setViewportBuildings()
 *   ┌──────────────────────────┐    useLiveQuery     ┌──────────────┐
 *   │ buildingsCollection      │ ◄──────────────────▶│ <App/> render│
 *   │ (local-only, reactive)   │                     └──────────────┘
 *   └──────────────────────────┘
 *
 * ONE TanStack DB collection is the unified set of buildings currently
 * visible. ONE polygon request per viewport change replaces its contents
 * atomically: buildings no longer visible are dropped, new ones inserted.
 */

import { createCollection, localOnlyCollectionOptions } from "@tanstack/react-db";
import { QueryClient } from "@tanstack/query-core";
import type { BdnbCleabsMapping, BdnbCompletRow, CityJsonBuilding } from "./types";

/** TanStack Query client used as a per-bbox HTTP cache. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 30,
      retry: 1,
    },
  },
});

/**
 * The single source of truth for rendered buildings. Local-only, so it
 * doesn't round-trip data through TanStack Query — we feed it via
 * `setViewportBuildings` from our own fetcher.
 */
export const buildingsCollection = createCollection(
  localOnlyCollectionOptions<CityJsonBuilding, string>({
    id: "buildings",
    getKey: (b) => b.geopf_id,
  }),
);

/**
 * cleabs -> batiment_groupe_id bridge fed by /bdnb/cleabs-mapping/bbox.
 * Lookups are by cleabs (our sat parquet grain); the value lets us index
 * into `bdnbCompletCollection` to pull any BDNB attribute.
 */
export const cleabsMappingCollection = createCollection(
  localOnlyCollectionOptions<BdnbCleabsMapping, string>({
    id: "cleabs-mapping",
    getKey: (m) => m.cleabs,
  }),
);

/**
 * BDNB `batiment_groupe_complet` rows fed by /bdnb/complet/bbox, keyed by
 * batiment_groupe_id. Carries mat_toit_txt today, all the other 60+ fields
 * stay on the wire for future features.
 */
export const bdnbCompletCollection = createCollection(
  localOnlyCollectionOptions<BdnbCompletRow, string>({
    id: "bdnb-complet",
    getKey: (r) => r.batiment_groupe_id,
  }),
);

/**
 * Reactive fetch-status summary, driven by `setViewportLoading` /
 * `setViewportError` / `setViewportBuildings`.
 */
export type ViewportStatus = "idle" | "loading" | "ready" | "error";
let currentStatus: ViewportStatus = "idle";
let currentError: string | null = null;
const statusListeners = new Set<() => void>();

function notifyStatus(): void {
  for (const l of statusListeners) l();
}

export function getViewportStatus(): { status: ViewportStatus; error: string | null } {
  return { status: currentStatus, error: currentError };
}

export function subscribeViewportStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

export function setViewportLoading(): void {
  if (currentStatus === "loading") return;
  currentStatus = "loading";
  currentError = null;
  notifyStatus();
}

export function setViewportError(message: string): void {
  currentStatus = "error";
  currentError = message;
  notifyStatus();
}

/**
 * Replace the visible buildings atomically. Anything in the collection but
 * not in `buildings` is deleted; anything new is inserted. Order doesn't
 * matter — the merge + render pipeline reads the full set.
 */
export function setViewportBuildings(buildings: CityJsonBuilding[]): void {
  const nextKeys = new Set(buildings.map((b) => b.geopf_id));

  // Delete buildings that are no longer visible.
  for (const existing of [...buildingsCollection.values()]) {
    if (!nextKeys.has(existing.geopf_id)) {
      buildingsCollection.delete(existing.geopf_id);
    }
  }
  // Insert new ones. local-only collections throw on duplicate keys, so
  // we skip buildings already present (they were re-sent for the same ids).
  for (const b of buildings) {
    if (!buildingsCollection.has(b.geopf_id)) {
      buildingsCollection.insert(b);
    }
  }

  currentStatus = "ready";
  currentError = null;
  notifyStatus();
}

/**
 * Replace the cleabs→groupe mapping atomically — same semantics as
 * `setViewportBuildings`. Stale rows outside the current viewport are
 * dropped so memory stays bounded.
 */
export function setViewportCleabsMapping(rows: BdnbCleabsMapping[]): void {
  const nextKeys = new Set(rows.map((r) => r.cleabs));
  for (const existing of [...cleabsMappingCollection.values()]) {
    if (!nextKeys.has(existing.cleabs)) {
      cleabsMappingCollection.delete(existing.cleabs);
    }
  }
  for (const r of rows) {
    if (!cleabsMappingCollection.has(r.cleabs)) {
      cleabsMappingCollection.insert(r);
    }
  }
}

/** Replace the BDNB complet rows atomically. */
export function setViewportBdnbComplet(rows: BdnbCompletRow[]): void {
  const nextKeys = new Set(rows.map((r) => r.batiment_groupe_id));
  for (const existing of [...bdnbCompletCollection.values()]) {
    if (!nextKeys.has(existing.batiment_groupe_id)) {
      bdnbCompletCollection.delete(existing.batiment_groupe_id);
    }
  }
  for (const r of rows) {
    if (!bdnbCompletCollection.has(r.batiment_groupe_id)) {
      bdnbCompletCollection.insert(r);
    }
  }
}
