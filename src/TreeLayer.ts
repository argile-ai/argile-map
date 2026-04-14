/**
 * deck.gl layers for tree visualization.
 *
 * Each tree is rendered as:
 *   - A thin brown column (trunk) from ground to crown base
 *   - A wide green column (crown) from crown base to tree top
 *
 * This reads as "tree" at a glance while staying fast for 8K+ trees.
 * Crown color is a green gradient by height.
 */

import { ColumnLayer } from "@deck.gl/layers";

export type TreeFeature = {
  position: [number, number];
  height_m: number;
  crown_diameter_m: number;
  crown_area_m2: number;
  is_conifer: boolean;
  n_points: number;
};

function crownColor(h: number, conifer: boolean): [number, number, number, number] {
  if (conifer) {
    // Dark green for conifers
    const t = Math.min(1, Math.max(0, (h - 3) / 20));
    return [10 + t * 30, 80 + t * 60, 20 + t * 20, 200];
  }
  // Bright green for deciduous
  const t = Math.min(1, Math.max(0, (h - 3) / 20));
  return [30 + t * 60, 120 + t * 100, 20 + t * 30, 200];
}

export function createTreeLayers(
  trees: TreeFeature[],
): ColumnLayer<TreeFeature>[] {
  if (trees.length === 0) return [];

  // Crown: wide green column (radius ~3m average crown)
  const crown = new ColumnLayer<TreeFeature>({
    id: "argile-tree-crowns",
    data: trees,
    pickable: true,
    diskResolution: 8,
    radius: 3,
    extruded: true,
    getPosition: (d) => d.position,
    getElevation: (d) => d.height_m * 0.5,
    getFillColor: (d) => crownColor(d.height_m, d.is_conifer),
    material: {
      ambient: 0.4,
      diffuse: 0.6,
      shininess: 10,
    },
  });

  // Trunk: thin brown column from ground to crown base
  const trunk = new ColumnLayer<TreeFeature>({
    id: "argile-tree-trunks",
    data: trees,
    pickable: false,
    diskResolution: 6,
    radius: 0.15,
    extruded: true,
    getPosition: (d) => d.position,
    getElevation: (d) => d.height_m * 0.5,
    getFillColor: [120, 80, 40, 220],
    material: {
      ambient: 0.3,
      diffuse: 0.7,
    },
  });

  return [trunk, crown];
}
