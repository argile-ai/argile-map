/**
 * Fetch sat detections inside the current viewport. Unlike buildings, the
 * detection endpoint accepts a polygon directly and returns <10k rows even
 * for dense Paris areas — we don't need a tile grid.
 *
 * We debounce the fetch slightly so quick pans don't hammer the backend.
 * TanStack Query handles deduplication by queryKey.
 */

import { useEffect, useState } from "react";
import { searchDetectionsByBounds } from "./api";
import { queryClient } from "./collections";
import type { Detection } from "./types";
import { areaKm2, type Bounds, snapBounds, snapCell } from "./useViewportBuildings";

const DEBOUNCE_MS = 300;

/**
 * Detections in dense urban areas (Marseille, Paris) easily exceed 10 000
 * per pan, blowing up to ~4 MB of JSON. Cap by viewport area so the
 * payload scales with what's actually visible. Hard cap at 3 000 — beyond
 * that the dots overlap on screen anyway.
 */
const DETECTIONS_HARD_CAP = 3_000;
const DETECTIONS_PER_KM2 = 3_000;

function boundsKey(b: Bounds): string {
  // Bounds are pre-snapped, so a fixed precision is enough to disambiguate.
  const r = (n: number) => n.toFixed(5);
  return `${r(b.minLat)}|${r(b.maxLat)}|${r(b.minLng)}|${r(b.maxLng)}`;
}

export function useViewportDetections(
  bounds: Bounds | null,
  zoom = 17,
): Detection[] {
  const [detections, setDetections] = useState<Detection[]>([]);

  useEffect(() => {
    if (!bounds) {
      setDetections([]);
      return;
    }
    let cancelled = false;
    const snapped = snapBounds(bounds, snapCell(zoom));
    const limit = Math.min(
      DETECTIONS_HARD_CAP,
      Math.ceil(areaKm2(snapped) * DETECTIONS_PER_KM2),
    );
    const timer = setTimeout(() => {
      queryClient
        .fetchQuery({
          queryKey: ["detections", boundsKey(snapped), limit],
          queryFn: ({ signal }) =>
            searchDetectionsByBounds({ bounds: snapped, minScore: 0.1, limit, signal }),
          staleTime: 1000 * 60 * 5,
        })
        .then((rows) => {
          if (!cancelled) setDetections(rows);
        })
        .catch((err) => {
          if (!cancelled && err?.name !== "AbortError") {
            console.warn("detections fetch failed", err);
          }
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [bounds, zoom]);

  return detections;
}
