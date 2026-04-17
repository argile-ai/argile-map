/**
 * Reactive BDNB data for the current viewport. Parallel to
 * `useViewportBuildings` — one request pair per bounds change (debounced),
 * cached through TanStack Query so pans that hit the same bbox bucket reuse
 * the response.
 *
 * Two endpoints run in parallel:
 *   - `/bdnb/cleabs-mapping/bbox` — cleabs → batiment_groupe_id
 *   - `/bdnb/complet/bbox`        — batiment_groupe_id → 60+ BDNB fields
 *
 * The hook returns a `MaterialLookup` that joins them: pass a cleabs, get
 * the roof material (or any other field we decide to expose on BdnbCompletRow).
 */

import { useLiveQuery } from "@tanstack/react-db";
import { useEffect, useMemo } from "react";
import { searchBdnbComplet, searchCleabsMapping } from "./api";
import {
  bdnbCompletCollection,
  cleabsMappingCollection,
  queryClient,
  setViewportBdnbComplet,
  setViewportCleabsMapping,
} from "./collections";
import type { BdnbCleabsMapping, BdnbCompletRow } from "./types";
import type { Bounds } from "./useViewportBuildings";

const DEBOUNCE_MS = 300;

function boundsKey(b: Bounds): string {
  const r = (n: number) => Math.round(n * 1e4) / 1e4;
  return `${r(b.minLat)}|${r(b.maxLat)}|${r(b.minLng)}|${r(b.maxLng)}`;
}

/**
 * View over the joined collections. `get(cleabs)` returns the full BDNB row
 * for that building (or undefined), doing cleabs → groupe → row in O(1).
 */
export type BdnbLookup = {
  get(cleabs: string): BdnbCompletRow | undefined;
  size: number;
};

export function useViewportBdnb(bounds: Bounds | null): BdnbLookup {
  useEffect(() => {
    if (!bounds) {
      setViewportCleabsMapping([]);
      setViewportBdnbComplet([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      const key = boundsKey(bounds);
      Promise.all([
        queryClient.fetchQuery({
          queryKey: ["bdnb-cleabs-mapping", key],
          queryFn: ({ signal }) => searchCleabsMapping({ bounds, signal }),
        }),
        queryClient.fetchQuery({
          queryKey: ["bdnb-complet", key],
          queryFn: ({ signal }) => searchBdnbComplet({ bounds, signal }),
        }),
      ])
        .then(([mapping, complet]) => {
          if (cancelled) return;
          setViewportCleabsMapping(mapping);
          setViewportBdnbComplet(complet);
        })
        .catch((err) => {
          if (cancelled || err?.name === "AbortError") return;
          // BDNB data is cosmetic — log and let the rest of the map render.
          console.warn("viewport BDNB fetch failed", err);
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [bounds]);

  // biome-ignore lint/suspicious/noExplicitAny: useLiveQuery infers the row type.
  const { data: mappingData } = useLiveQuery((q: any) => q.from({ m: cleabsMappingCollection }));
  // biome-ignore lint/suspicious/noExplicitAny: useLiveQuery infers the row type.
  const { data: completData } = useLiveQuery((q: any) => q.from({ c: bdnbCompletCollection }));

  return useMemo<BdnbLookup>(() => {
    const mappings = (mappingData ?? []) as BdnbCleabsMapping[];
    const rows = (completData ?? []) as BdnbCompletRow[];
    const rowByGroupe = new Map<string, BdnbCompletRow>();
    for (const r of rows) rowByGroupe.set(r.batiment_groupe_id, r);
    const rowByCleabs = new Map<string, BdnbCompletRow>();
    for (const m of mappings) {
      const row = rowByGroupe.get(m.batiment_groupe_id);
      if (row) rowByCleabs.set(m.cleabs, row);
    }
    return {
      get: (cleabs: string) => rowByCleabs.get(cleabs),
      size: rowByCleabs.size,
    };
  }, [mappingData, completData]);
}
