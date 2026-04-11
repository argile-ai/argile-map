/**
 * deck.gl layer that overlays AI-detected roof features (roof windows, PV
 * panels, chimneys) on top of the 3D buildings.
 *
 * Current DB doesn't store georeferenced bounding boxes yet — only pixel
 * bboxes + the building centroid. We therefore place each detection at the
 * building's (center_lon, center_lat) and stack them vertically above the
 * building to avoid z-fighting when there are multiple detections on the
 * same building. A real 3D placement via raycasting against the CityJSON
 * roof mesh is tracked as a follow-up.
 *
 * Rendering uses TextLayer with emoji glyphs because:
 *   - no asset pipeline / no SDF fonts (TextLayer ships the default font)
 *   - native billboarding toward the camera
 *   - emoji work out-of-the-box in all modern browsers
 */

import { TextLayer } from "@deck.gl/layers";
import type { Detection } from "./types";

const EMOJI: Record<string, string> = {
  "roof window": "🪟",
  "photovoltaic solar panel": "☀️",
  chimney: "🏭",
};

/** Base roof-level elevation (m). Chosen to sit above typical houses. */
const ROOF_BASE_ELEVATION_M = 8;
/** Vertical stacking step (m) when multiple detections share a building. */
const STACK_STEP_M = 1.5;

type Marker = {
  position: [number, number, number];
  text: string;
  color: [number, number, number, number];
};

function colorFor(label: string): [number, number, number, number] {
  switch (label) {
    case "roof window":
      return [96, 180, 255, 255];
    case "photovoltaic solar panel":
      return [255, 180, 40, 255];
    case "chimney":
      return [200, 200, 200, 255];
    default:
      return [255, 255, 255, 255];
  }
}

export function toMarkers(detections: Detection[]): Marker[] {
  // Group by building so we can stack multiple detections vertically.
  const byBuilding = new Map<string, Detection[]>();
  for (const det of detections) {
    const bucket = byBuilding.get(det.building_id);
    if (bucket) bucket.push(det);
    else byBuilding.set(det.building_id, [det]);
  }

  const markers: Marker[] = [];
  for (const bucket of byBuilding.values()) {
    // Sort by score descending so the most confident detection sits lowest
    // (most visible). Ties broken by label for stability.
    bucket.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
    bucket.forEach((det, i) => {
      markers.push({
        position: [det.center_lon, det.center_lat, ROOF_BASE_ELEVATION_M + i * STACK_STEP_M],
        text: EMOJI[det.label] ?? "•",
        color: colorFor(det.label),
      });
    });
  }
  return markers;
}

export function createDetectionLayer(
  detections: Detection[],
): TextLayer<Marker> | null {
  if (detections.length === 0) return null;
  const data = toMarkers(detections);
  return new TextLayer<Marker>({
    id: "argile-detections",
    data,
    getPosition: (m) => m.position,
    getText: (m) => m.text,
    getColor: (m) => m.color,
    getSize: 32,
    sizeUnits: "pixels",
    // Always face the camera, scale with zoom like a HUD marker.
    billboard: true,
    fontFamily: "system-ui, -apple-system, 'Segoe UI Emoji', sans-serif",
    fontWeight: 400,
    background: true,
    backgroundPadding: [4, 2, 4, 2],
    getBackgroundColor: [20, 20, 30, 200],
    getBorderColor: [255, 255, 255, 180],
    getBorderWidth: 1,
    characterSet: "auto",
    outlineWidth: 0,
    pickable: true,
  });
}
