/**
 * Coarse geographic tile grid (~400m per tile at Paris latitude). Used to chunk
 * CityJSON searches so that the same tile isn't refetched as the user pans
 * inside it, and so that neighboring tiles can be reused when panning.
 *
 * NOT a standard XYZ tile scheme — we don't need one since the backend uses a
 * radius query. A fixed-degree grid is simpler and good enough for a city view.
 */

const TILE_SIZE_DEG = 0.0036; // ~400m lat, ~265m lng at 48°

export type TileId = `${number}_${number}`;

export type Tile = {
  id: TileId;
  lat: number; // tile center
  lng: number;
  /** Radius in meters that covers the tile (with a small margin). */
  radiusM: number;
};

function toTile(lat: number, lng: number): Tile {
  const tx = Math.floor(lng / TILE_SIZE_DEG);
  const ty = Math.floor(lat / TILE_SIZE_DEG);
  const cLng = (tx + 0.5) * TILE_SIZE_DEG;
  const cLat = (ty + 0.5) * TILE_SIZE_DEG;
  // Half-diagonal in meters (worst case) with 20% margin so neighboring
  // buildings near the tile edge still get picked up.
  const latMeters = (TILE_SIZE_DEG / 2) * 111_000;
  const lngMeters = latMeters * Math.cos((cLat * Math.PI) / 180);
  const diagonal = Math.sqrt(latMeters ** 2 + lngMeters ** 2);
  return {
    id: `${tx}_${ty}`,
    lat: cLat,
    lng: cLng,
    radiusM: Math.ceil(diagonal * 1.2),
  };
}

/**
 * Return every tile that overlaps the given bounding box, plus the 1-tile
 * border so buildings straddling the edge are included.
 */
export function tilesInBounds(bounds: {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}): Tile[] {
  const { minLat, maxLat, minLng, maxLng } = bounds;
  const tiles = new Map<TileId, Tile>();
  const stepLat = TILE_SIZE_DEG;
  const stepLng = TILE_SIZE_DEG;
  for (let lat = minLat - stepLat; lat <= maxLat + stepLat; lat += stepLat) {
    for (let lng = minLng - stepLng; lng <= maxLng + stepLng; lng += stepLng) {
      const tile = toTile(lat, lng);
      tiles.set(tile.id, tile);
    }
  }
  return [...tiles.values()];
}
