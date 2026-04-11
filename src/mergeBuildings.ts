/**
 * Pure merge of multiple parsed CityJSON buildings into a single triangle
 * soup, with each building's (lng, lat) offset baked into the vertex
 * positions. This module has no runtime dependency on three.js or the
 * cityjson loader — it's called from BuildingLayer.ts and is fully
 * testable in isolation.
 */

export type TriangleSoup = {
  /** (east, north, up) in meters, relative to the building's local origin. */
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
};

export type ParsedBuilding = {
  geopf_id: string;
  /** WGS84 centroid of the building, used as the anchor for the local frame. */
  lat: number;
  lng: number;
  /** Triangle soup in local meters (east/north/up), centered at (0, 0). */
  soup: TriangleSoup;
  /** Height of the highest triangle above the local z origin. */
  height: number;
};

/**
 * Merge N parsed buildings into a single triangle soup. The resulting soup is
 * expressed in meters relative to `origin`, so it can be rendered with
 * deck.gl `COORDINATE_SYSTEM.METER_OFFSETS` and `coordinateOrigin: [lng, lat]`.
 *
 * Flat-earth approximation: at Paris latitude, the error over 1 km is ~1 mm,
 * which is well below our rendering precision.
 */
export function mergeBuildings(
  buildings: ParsedBuilding[],
  origin: { lat: number; lng: number },
): TriangleSoup {
  const R = 6_378_137;
  const latRad = (origin.lat * Math.PI) / 180;
  const metersPerDegLat = (Math.PI * R) / 180;
  const metersPerDegLng = metersPerDegLat * Math.cos(latRad);

  let totalVerts = 0;
  let totalIdx = 0;
  for (const b of buildings) {
    totalVerts += b.soup.positions.length;
    totalIdx += b.soup.indices.length;
  }
  const mergedPositions = new Float32Array(totalVerts);
  const mergedNormals = new Float32Array(totalVerts);
  const mergedIndices = new Uint32Array(totalIdx);

  let vWrite = 0;
  let iWrite = 0;
  let vOffset = 0;
  for (const b of buildings) {
    const east = (b.lng - origin.lng) * metersPerDegLng;
    const north = (b.lat - origin.lat) * metersPerDegLat;
    const pos = b.soup.positions;
    const nrm = b.soup.normals;
    for (let i = 0; i < pos.length; i += 3) {
      mergedPositions[vWrite] = pos[i] + east;
      mergedPositions[vWrite + 1] = pos[i + 1] + north;
      mergedPositions[vWrite + 2] = pos[i + 2];
      mergedNormals[vWrite] = nrm[i];
      mergedNormals[vWrite + 1] = nrm[i + 1];
      mergedNormals[vWrite + 2] = nrm[i + 2];
      vWrite += 3;
    }
    const idx = b.soup.indices;
    for (let i = 0; i < idx.length; i++) {
      mergedIndices[iWrite++] = idx[i] + vOffset;
    }
    vOffset += pos.length / 3;
  }

  return { positions: mergedPositions, normals: mergedNormals, indices: mergedIndices };
}
