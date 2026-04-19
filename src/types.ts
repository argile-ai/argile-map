/** Geo types. Matches the `app/schemas/cityjson.py` pydantic models. */

export type CityJsonBuilding = {
  geopf_id: string;
  lat: number;
  lng: number;
  multipolygon_geojson: GeoJSON.MultiPolygon | GeoJSON.Polygon;
  cityjson: CityJson;
};

export type CityJsonSearchResponse = {
  count: number;
  buildings: CityJsonBuilding[];
  query_ms: number;
};

/**
 * Minimal CityJSON v2.0 shape, enough for cityjson-threejs-loader and
 * basic introspection. The loader is permissive with extra fields.
 */
export type CityJson = {
  type: "CityJSON";
  version: string;
  transform?: { scale: [number, number, number]; translate: [number, number, number] };
  CityObjects: Record<string, CityObject>;
  vertices: Array<[number, number, number]>;
  metadata?: Record<string, unknown>;
};

export type CityObject = {
  type: string;
  geometry?: CityGeometry[];
  children?: string[];
  parents?: string[];
  attributes?: Record<string, unknown>;
};

export type CityGeometry = {
  type: "Solid" | "MultiSurface" | "CompositeSolid" | "MultiSolid";
  lod: string | number;
  boundaries: unknown;
  semantics?: {
    surfaces: Array<{ type: string }>;
    values: unknown;
  };
};

/**
 * AI-detected roof feature (roof window, PV panel, chimney) from the
 * sat-api service (`/sat/detections/search`). The current DB doesn't have
 * georeferenced bboxes yet, so we only get pixel bboxes + the building
 * centroid — we render markers at the centroid + a fixed roof elevation.
 */
export type DetectionLabel = "roof window" | "photovoltaic solar panel" | "chimney";

export type Detection = {
  building_id: string;
  label: DetectionLabel | string;
  score: number;
  box_xmin: number;
  box_ymin: number;
  box_xmax: number;
  box_ymax: number;
  /** Optional WGS84 georeferenced bbox (only populated for recent imports). */
  geo_xmin?: number | null;
  geo_ymin?: number | null;
  geo_xmax?: number | null;
  geo_ymax?: number | null;
  center_lat: number;
  center_lon: number;
};

export type DetectionSearchResponse = {
  count: number;
  detections: Detection[];
};

/**
 * A tree extracted from the IGN LIDAR HD nationwide point cloud by
 * `trees/extract/worker.py`, served via `/trees/search`. Matches
 * `trees/serve/schemas.py::TreeOut`.
 */
export type Tree = {
  tree_id: string;
  lat: number;
  lng: number;
  height_m: number;
  crown_diameter_m: number;
  crown_area_m2: number;
  n_points: number;
  is_conifer: boolean;
};

export type TreeSearchResponse = {
  count: number;
  trees: Tree[];
};

/**
 * One row of the `/bdnb/complet/bbox` response from argeme. The full schema
 * has 60+ fields (drop-in replacement for api.bdnb.io) — we only type the
 * ones we actually read. Everything else stays on the wire but is ignored.
 */
export type BdnbCompletRow = {
  batiment_groupe_id: string;
  /**
   * BDNB building-group footprint in Lambert 93 (EPSG:2154). Used client-side
   * to match a CityJSON building to its BDNB groupe via point-in-polygon —
   * the cityjson pipeline stores WFS feature IDs, not BDTOPO cleabs, so a
   * direct ID join is not possible. See useViewportBdnb for the lookup.
   */
  geom_groupe?: GeoJSON.MultiPolygon | GeoJSON.Polygon | null;
  mat_toit_txt?: string | null;
  mat_mur_txt?: string | null;
  annee_construction?: number | null;
  nb_niveau?: number | null;
  hauteur_mean?: number | null;
  usage_principal_bdnb_open?: string | null;
};
