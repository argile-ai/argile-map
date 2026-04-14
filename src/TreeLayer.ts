/**
 * deck.gl layer for visualizing extracted trees.
 *
 * Each tree is rendered as a circle (ScatterplotLayer) with:
 *   - radius = crown_diameter / 2
 *   - color = green gradient by height (dark green = short, bright green = tall)
 *   - slight transparency so buildings underneath remain visible
 */

import { ScatterplotLayer } from "@deck.gl/layers";

export type TreeFeature = {
  /** [lng, lat, elevation_m] — elevation = tree height so the disc floats at canopy level */
  position: [number, number, number];
  height_m: number;
  crown_diameter_m: number;
  crown_area_m2: number;
  is_conifer: boolean;
  n_points: number;
};

function heightToColor(h: number): [number, number, number, number] {
  // 3m = dark green, 25m = bright lime
  const t = Math.min(1, Math.max(0, (h - 3) / 22));
  return [
    Math.round(20 + t * 80),   // R: 20 → 100
    Math.round(100 + t * 155), // G: 100 → 255
    Math.round(30 + t * 20),   // B: 30 → 50
    180,
  ];
}

export function createTreeLayer(
  trees: TreeFeature[],
): ScatterplotLayer<TreeFeature> | null {
  if (trees.length === 0) return null;

  return new ScatterplotLayer<TreeFeature>({
    id: "argile-trees",
    data: trees,
    pickable: true,
    stroked: true,
    filled: true,
    getPosition: (d) => d.position,
    getRadius: (d) => Math.max(1, d.crown_diameter_m / 2),
    getFillColor: (d) => heightToColor(d.height_m),
    getLineColor: [30, 80, 20, 200],
    getLineWidth: 0.2,
    radiusUnits: "meters",
    lineWidthUnits: "meters",
    radiusMinPixels: 2,
  });
}
