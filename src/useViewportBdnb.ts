/**
 * Reactive BDNB data for the current viewport. Parallel to
 * `useViewportBuildings` — one debounced request per bounds change, cached
 * through TanStack Query so pans that hit the same bbox bucket reuse the
 * response.
 *
 * The frontend can't join BDNB by ID: the `/cityjson/search` pipeline stores
 * IGN WFS feature IDs (`batiment.<num>`) while BDNB is keyed on BDTOPO
 * `cleabs` (`BATIMENT0000000…`). The two spaces are disjoint. Instead we
 * match each building to its BDNB groupe by point-in-polygon against
 * `geom_groupe` (Lambert 93). Long-term fix: add `cleabs` to cityjson_search;
 * then this geometric fallback can be replaced with a direct ID lookup.
 */

import { useLiveQuery } from "@tanstack/react-db";
import { useEffect, useMemo } from "react";
import { searchBdnbComplet } from "./api";
import { bdnbCompletCollection, queryClient, setViewportBdnbComplet } from "./collections";
import type { BdnbCompletRow } from "./types";
import type { Bounds } from "./useViewportBuildings";

const DEBOUNCE_MS = 300;

function boundsKey(b: Bounds): string {
  const r = (n: number) => Math.round(n * 1e4) / 1e4;
  return `${r(b.minLat)}|${r(b.maxLat)}|${r(b.minLng)}|${r(b.maxLng)}`;
}

/**
 * Lookup a BDNB groupe row for a point in Lambert 93 coordinates. Walks every
 * groupe in the current viewport with a bbox prefilter, then runs
 * point-in-polygon on the exterior rings. Callers pass the CityJSON metadata
 * `geographicalExtent` midpoint — see `cityjsonMesh.ts`.
 */
export type BdnbLookup = {
  findByLambert93Point(x: number, y: number): BdnbCompletRow | undefined;
  /** Total rows available in the viewport (not matches — raw count). */
  size: number;
};

type PreparedRow = {
  row: BdnbCompletRow;
  polygons: Array<{
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    ring: readonly (readonly number[])[];
  }>;
};

function prepareRow(row: BdnbCompletRow): PreparedRow | null {
  const geom = row.geom_groupe;
  if (!geom) return null;
  const polys: readonly (readonly (readonly (readonly number[])[])[])[] =
    geom.type === "MultiPolygon"
      ? geom.coordinates
      : geom.type === "Polygon"
        ? [geom.coordinates]
        : [];
  const polygons: PreparedRow["polygons"] = [];
  for (const poly of polys) {
    if (poly.length === 0) continue;
    const ring = poly[0];
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const pt of ring) {
      const x = pt[0];
      const y = pt[1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    polygons.push({ minX, minY, maxX, maxY, ring });
  }
  if (polygons.length === 0) return null;
  return { row, polygons };
}

/** Classic ray-casting point-in-polygon on a single ring. */
function pointInRing(x: number, y: number, ring: readonly (readonly number[])[]): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function useViewportBdnb(bounds: Bounds | null): BdnbLookup {
  useEffect(() => {
    if (!bounds) {
      setViewportBdnbComplet([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      queryClient
        .fetchQuery({
          queryKey: ["bdnb-complet", boundsKey(bounds)],
          queryFn: ({ signal }) => searchBdnbComplet({ bounds, signal }),
        })
        .then((rows) => {
          if (cancelled) return;
          setViewportBdnbComplet(rows);
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
  const { data: completData } = useLiveQuery((q: any) => q.from({ c: bdnbCompletCollection }));

  return useMemo<BdnbLookup>(() => {
    const rows = (completData ?? []) as BdnbCompletRow[];
    const prepared: PreparedRow[] = [];
    for (const r of rows) {
      const p = prepareRow(r);
      if (p) prepared.push(p);
    }
    return {
      size: rows.length,
      findByLambert93Point(x, y) {
        for (const p of prepared) {
          for (const poly of p.polygons) {
            if (x < poly.minX || x > poly.maxX || y < poly.minY || y > poly.maxY) continue;
            if (pointInRing(x, y, poly.ring)) return p.row;
          }
        }
        return undefined;
      },
    };
  }, [completData]);
}
