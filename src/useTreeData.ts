/**
 * Load tree data from a static GeoJSON file. In production this will be
 * replaced by an API call to /trees/search, but for now we serve a
 * pre-extracted file to validate the visualization.
 */

import { useEffect, useState } from "react";
import type { TreeFeature } from "./TreeLayer";

const TREE_GEOJSON_URL = "/trees.geojson";

export function useTreeData(): TreeFeature[] {
  const [trees, setTrees] = useState<TreeFeature[]>([]);

  useEffect(() => {
    fetch(TREE_GEOJSON_URL)
      .then((r) => {
        if (!r.ok) return [];
        return r.json();
      })
      .then((data) => {
        if (!data?.features) return;
        const parsed: TreeFeature[] = data.features.map(
          // biome-ignore lint/suspicious/noExplicitAny: GeoJSON feature shape
          (f: any) => ({
            position: f.geometry.coordinates as [number, number],
            height_m: f.properties.height_m,
            crown_diameter_m: f.properties.crown_diameter_m,
            crown_area_m2: f.properties.crown_area_m2,
            is_conifer: f.properties.is_conifer,
            n_points: f.properties.n_points,
          }),
        );
        setTrees(parsed);
      })
      .catch(() => {});
  }, []);

  return trees;
}
