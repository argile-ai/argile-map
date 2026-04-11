import { config } from "./config";
import type {
  CityJsonBuilding,
  CityJsonSearchResponse,
  Detection,
  DetectionSearchResponse,
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
