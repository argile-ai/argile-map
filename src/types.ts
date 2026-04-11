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

