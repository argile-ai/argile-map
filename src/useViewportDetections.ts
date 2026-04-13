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
import type { Bounds } from "./useViewportBuildings";

const DEBOUNCE_MS = 300;

function boundsKey(b: Bounds): string {
  // Round to ~10m so small pans don't invalidate the cache unnecessarily.
  const r = (n: number) => Math.round(n * 1e4) / 1e4;
  return `${r(b.minLat)}|${r(b.maxLat)}|${r(b.minLng)}|${r(b.maxLng)}`;
}

export function useViewportDetections(bounds: Bounds | null): Detection[] {
  const [detections, setDetections] = useState<Detection[]>([]);

  useEffect(() => {
    if (!bounds) {
      setDetections([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      queryClient
        .fetchQuery({
          queryKey: ["detections", boundsKey(bounds)],
          queryFn: ({ signal }) => searchDetectionsByBounds({ bounds, minScore: 0.4, signal }),
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
  }, [bounds]);

  return detections;
}
