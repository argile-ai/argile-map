import { config } from "./config";
import type { CityJsonBuilding, CityJsonSearchResponse } from "./types";

/** Search buildings by center + radius (meters). */
export async function searchBuildingsByRadius(params: {
  lat: number;
  lng: number;
  radiusM: number;
  limit?: number;
  signal?: AbortSignal;
}): Promise<CityJsonBuilding[]> {
  const { lat, lng, radiusM, limit = 500, signal } = params;
  const response = await fetch(`${config.apiUrl}/cityjson/search`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(config.apiKey ? { "X-API-Key": config.apiKey } : {}),
    },
    body: JSON.stringify({
      center: [lat, lng],
      radius_m: radiusM,
      limit,
    }),
  });
  if (!response.ok) {
    throw new Error(`Argile API /cityjson/search ${response.status}`);
  }
  const data = (await response.json()) as CityJsonSearchResponse;
  return data.buildings;
}
