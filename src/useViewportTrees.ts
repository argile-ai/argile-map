/**
 * Fetch trees inside the current viewport from `/trees/search`. The backend
 * caps results at `limit` rows; at zoom 15+ a pitched viewport in a forested
 * area returns a few thousand trees, well under the limit.
 */

import { useEffect, useState } from "react";
import { searchTreesInBounds } from "./api";
import { queryClient } from "./collections";
import type { TreeFeature } from "./TreeLayer";
import { areaKm2, type Bounds, snapBounds, snapCell } from "./useViewportBuildings";

const DEBOUNCE_MS = 300;

/**
 * Trees are cheap on the wire (~200 B each) but every tree drops ~40
 * vertices on the GPU, so a 5 000-tree dense viewport rebuilds 200 k
 * vertices on every pan. 2 000 is a comfortable upper bound — beyond it
 * extras stack behind buildings anyway.
 */
const TREES_HARD_CAP = 2_000;
const TREES_PER_KM2 = 1_500;

function boundsKey(b: Bounds): string {
  const r = (n: number) => n.toFixed(5);
  return `${r(b.minLat)}|${r(b.maxLat)}|${r(b.minLng)}|${r(b.maxLng)}`;
}

export function useViewportTrees(bounds: Bounds | null, zoom = 17): TreeFeature[] {
  const [trees, setTrees] = useState<TreeFeature[]>([]);

  useEffect(() => {
    if (!bounds) {
      setTrees([]);
      return;
    }
    let cancelled = false;
    const snapped = snapBounds(bounds, snapCell(zoom));
    const limit = Math.min(TREES_HARD_CAP, Math.ceil(areaKm2(snapped) * TREES_PER_KM2));
    const timer = setTimeout(() => {
      queryClient
        .fetchQuery({
          queryKey: ["trees", boundsKey(snapped), limit],
          queryFn: ({ signal }) => searchTreesInBounds({ bounds: snapped, limit, signal }),
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
  }, [bounds, zoom]);

  return trees;
}
