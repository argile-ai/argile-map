/**
 * Fetch trees inside the current viewport from `/trees/search`. The backend
 * caps results at `limit` rows; at zoom 15+ a pitched viewport in a forested
 * area returns a few thousand trees, well under the limit.
 */

import { useEffect, useState } from "react";
import { searchTreesInBounds } from "./api";
import { queryClient } from "./collections";
import type { TreeFeature } from "./TreeLayer";
import type { Bounds } from "./useViewportBuildings";

const DEBOUNCE_MS = 300;

function boundsKey(b: Bounds): string {
  const r = (n: number) => Math.round(n * 1e4) / 1e4;
  return `${r(b.minLat)}|${r(b.maxLat)}|${r(b.minLng)}|${r(b.maxLng)}`;
}

export function useViewportTrees(bounds: Bounds | null): TreeFeature[] {
  const [trees, setTrees] = useState<TreeFeature[]>([]);

  useEffect(() => {
    if (!bounds) {
      setTrees([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      queryClient
        .fetchQuery({
          queryKey: ["trees", boundsKey(bounds)],
          queryFn: ({ signal }) => searchTreesInBounds({ bounds, limit: 5000, signal }),
          staleTime: 1000 * 60 * 5,
        })
        .then((rows) => {
          if (cancelled) return;
          const features: TreeFeature[] = rows.map((r) => ({
            position: [r.lng, r.lat],
            height_m: r.height_m,
            crown_diameter_m: r.crown_diameter_m,
            crown_area_m2: r.crown_area_m2,
            is_conifer: r.is_conifer,
            n_points: r.n_points,
          }));
          setTrees(features);
        })
        .catch((err) => {
          if (!cancelled && err?.name !== "AbortError") {
            console.warn("trees fetch failed", err);
          }
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [bounds]);

  return trees;
}
