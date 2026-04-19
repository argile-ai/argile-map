import { config } from "./config";
import type {
  BdnbCompletRow,
  CityJsonBuilding,
  CityJsonSearchResponse,
  Detection,
  DetectionSearchResponse,
  Tree,
  TreeSearchResponse,
} from "./types";

/**
 * Search every building whose centroid falls inside the viewport bbox. ONE
 * round trip per viewport change — much cheaper than the previous per-tile
 * grid that fired dozens of requests per pan.
 *
 * The backend caps the query area at MAX_AREA_M2 = 10 km² (see
 * app/services/cityjson_search.py). At zoom 15 a pitched viewport in
 * Paris is ~1-2 km², well within the limit.
 */
export async function searchBuildingsInBounds(params: {
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  limit?: number;
  signal?: AbortSignal;
}): Promise<CityJsonBuilding[]> {
  const { bounds, limit = 10_000, signal } = params;
  const polygon = {
    type: "Polygon" as const,
    coordinates: [
      [
        [bounds.minLng, bounds.minLat],
        [bounds.maxLng, bounds.minLat],
        [bounds.maxLng, bounds.maxLat],
        [bounds.minLng, bounds.maxLat],
        [bounds.minLng, bounds.minLat],
      ],
    ],
  };
  const response = await fetch(`${config.apiUrl}/cityjson/search`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      geometry: polygon,
      crs: "EPSG:4326",
      limit,
    }),
  });
  if (!response.ok) {
    throw new Error(`Argile API /cityjson/search ${response.status}`);
  }
  const data = (await response.json()) as CityJsonSearchResponse;
  return data.buildings;
}

/**
 * Search sat detections (roof windows / PV panels / chimneys) that fall
 * inside a WGS84 polygon. The backend routes `/sat/*` to the sat-api service
 * via Traefik stripprefix (see docker-compose.yml "sat-strip").
 */
export async function searchDetectionsByBounds(params: {
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  labels?: string[];
  minScore?: number;
  limit?: number;
  signal?: AbortSignal;
}): Promise<Detection[]> {
  const { bounds, labels, minScore = 0.3, limit = 10_000, signal } = params;
  const polygon = {
    type: "Polygon" as const,
    coordinates: [
      [
        [bounds.minLng, bounds.minLat],
        [bounds.maxLng, bounds.minLat],
        [bounds.maxLng, bounds.maxLat],
        [bounds.minLng, bounds.maxLat],
        [bounds.minLng, bounds.minLat],
      ],
    ],
  };
  const response = await fetch(`${config.apiUrl}/sat/detections/search`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      geometry: polygon,
      crs: "EPSG:4326",
      labels,
      min_score: minScore,
      limit,
    }),
  });
  if (!response.ok) {
    throw new Error(`Argile API /sat/detections/search ${response.status}`);
  }
  const data = (await response.json()) as DetectionSearchResponse;
  return data.detections;
}

/**
 * Fetch full `batiment_groupe_complet` rows (60+ fields including
 * `mat_toit_txt`, `mat_mur_txt`, `annee_construction`, DPE, …) for every
 * groupe whose centroid falls in `bounds`.
 *
 * The argeme endpoint is a drop-in mirror of api.bdnb.io — we read whatever
 * fields we want off the rows and let the rest stay idle.
 */
export async function searchBdnbComplet(params: {
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  /** Server-side cap; argeme enforces max 5000. */
  limit?: number;
  signal?: AbortSignal;
}): Promise<BdnbCompletRow[]> {
  const { bounds, limit = 5000, signal } = params;
  const qs = new URLSearchParams({
    xmin: String(bounds.minLng),
    xmax: String(bounds.maxLng),
    ymin: String(bounds.minLat),
    ymax: String(bounds.maxLat),
    srid: "4326",
    limit: String(limit),
  });
  const response = await fetch(`${config.argemeUrl}/bdnb/complet/bbox?${qs}`, { signal });
  if (!response.ok) {
    throw new Error(`argeme /bdnb/complet/bbox ${response.status}`);
  }
  return (await response.json()) as BdnbCompletRow[];
}

/**
 * Search trees extracted from IGN LIDAR HD inside the current viewport.
 * Routed through Traefik's `/trees` stripprefix → trees-api `/search`.
 */
export async function searchTreesInBounds(params: {
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  minHeight?: number;
  isConifer?: boolean;
  limit?: number;
  signal?: AbortSignal;
}): Promise<Tree[]> {
  const { bounds, minHeight = 3, isConifer, limit = 5000, signal } = params;
  const polygon = {
    type: "Polygon" as const,
    coordinates: [
      [
        [bounds.minLng, bounds.minLat],
        [bounds.maxLng, bounds.minLat],
        [bounds.maxLng, bounds.maxLat],
        [bounds.minLng, bounds.maxLat],
        [bounds.minLng, bounds.minLat],
      ],
    ],
  };
  const response = await fetch(`${config.apiUrl}/trees/search`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      geometry: polygon,
      crs: "EPSG:4326",
      min_height_m: minHeight,
      is_conifer: isConifer,
      limit,
    }),
  });
  if (!response.ok) {
    throw new Error(`Argile API /trees/search ${response.status}`);
  }
  const data = (await response.json()) as TreeSearchResponse;
  return data.trees;
}
