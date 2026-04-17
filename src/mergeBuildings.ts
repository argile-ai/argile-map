/**
 * Pure merge of multiple parsed CityJSON buildings into a single triangle
 * soup, with each building's (lng, lat) offset baked into the vertex
 * positions. This module has no runtime dependency on three.js or the
 * cityjson loader — it's called from BuildingLayer.ts and is fully
 * testable in isolation.
 */

/**
 * Lambert93 (EPSG:2154) is the CRS of roofer's CityJSON output. It's a
 * Lambert Conformal Conic with central meridian λ₀ = 3°E and exponent
 * n = sin(φ₀) ≈ 0.7256067949 (derived from the two standard parallels
 * 44°N and 49°N). Its easting axis is rotated relative to WGS84 East/North
 * by the meridian convergence γ = n · (λ - λ₀). We rotate local Lambert93
 * deltas by γ to express them as WGS84 local East/North meters.
 *
 * See: https://epsg.io/2154 — n is exact to 10 digits.
 */
export const LAMBERT93_N = 0.7256067949;
const LAMBERT93_LAMBDA0_RAD = (3 * Math.PI) / 180;

/**
 * Meridian convergence γ at a given WGS84 longitude (in degrees). Radians.
 * Positive γ means Lambert93 N is tilted east of true north (i.e. the
 * longitude is east of the central meridian).
 */
export function lambert93Convergence(lngDeg: number): number {
  return LAMBERT93_N * ((lngDeg * Math.PI) / 180 - LAMBERT93_LAMBDA0_RAD);
}

/**
 * Rotate a Lambert93-local (dx, dy) delta into a WGS84 (east, north) delta,
 * applying the meridian convergence at `lngDeg`.
 *
 *   ┌ east  ┐   ┌  cos γ   sin γ ┐ ┌ dx ┐
 *   └ north ┘ = └ -sin γ   cos γ ┘ └ dy ┘
 */
export function rotateLambert93ToEastNorth(
  dx: number,
  dy: number,
  lngDeg: number,
): [number, number] {
  const g = lambert93Convergence(lngDeg);
  const c = Math.cos(g);
  const s = Math.sin(g);
  return [dx * c + dy * s, -dx * s + dy * c];
}

export type TriangleSoup = {
  /** (east, north, up) in meters, relative to the building's local origin. */
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** Per-vertex surface type from the CityJSON loader:
   *  0=GroundSurface, 1=WallSurface, 2=RoofSurface, -1=unknown */
  surfaceTypes: Int32Array;
};

export type ParsedBuilding = {
  geopf_id: string;
  /** WGS84 centroid of the building, used as the anchor for the local frame. */
  lat: number;
  lng: number;
  /**
   * Lambert 93 (EPSG:2154) centroid of the building, derived from the CityJSON
   * metadata `geographicalExtent`. Used for point-in-polygon joins against
   * BDNB geom_groupe (which is also in Lambert 93) — avoids pulling in a
   * WGS84↔Lambert93 projection library on the client.
   */
  lambert93Center: [number, number] | null;
  /** Triangle soup in local meters (east/north/up), centered at (0, 0). */
  soup: TriangleSoup;
  /** Height of the highest triangle above the local z origin. */
  height: number;
  /** Centroid of the roof surface (surfacetype=2), in local meters, or null
   *  if no roof triangles were found. */
  roofCentroid: [number, number, number] | null;
  /** Average unit normal of the roof surface, or null if none found. */
  roofNormal: [number, number, number] | null;
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

  return {
    positions: mergedPositions,
    normals: mergedNormals,
    indices: mergedIndices,
    surfaceTypes: new Int32Array(0), // not needed for the merged building mesh
  };
}

/** CityJSON surface type index for roof polygons. */
const SURFACE_TYPE_ROOF = 2;

/**
 * Split each building's triangles by (roof vs. body) and, for roofs, by the
 * caller-provided material category. Returns one triangle soup per category;
 * the render layer creates one SimpleMeshLayer per soup (cheap: N is at most
 * 1 + number-of-material-categories).
 *
 * `materialOf` returns an arbitrary category string for a given building; the
 * caller chooses the vocabulary (e.g. "tuiles" / "ardoises" / …). Buildings
 * whose `materialOf` returns null have all their roof triangles folded into
 * the body mesh — so the fallback render matches `mergeBuildings` exactly.
 *
 * Memory: each material soup duplicates vertices across triangles (no
 * sharing) to avoid per-material remap lookups. For ~1k buildings × a few
 * thousand triangles this is negligible.
 */
export function mergeBuildingsByMaterial<M extends string>(
  buildings: ParsedBuilding[],
  origin: { lat: number; lng: number },
  materialOf: (b: ParsedBuilding) => M | null,
): { body: TriangleSoup; roofsByMaterial: Map<M, TriangleSoup> } {
  const R = 6_378_137;
  const latRad = (origin.lat * Math.PI) / 180;
  const metersPerDegLat = (Math.PI * R) / 180;
  const metersPerDegLng = metersPerDegLat * Math.cos(latRad);

  type Accum = { positions: number[]; normals: number[] };
  const body: Accum = { positions: [], normals: [] };
  const byMaterial = new Map<M, Accum>();

  for (const b of buildings) {
    const mat = materialOf(b);
    const east = (b.lng - origin.lng) * metersPerDegLng;
    const north = (b.lat - origin.lat) * metersPerDegLat;
    const pos = b.soup.positions;
    const nrm = b.soup.normals;
    const idx = b.soup.indices;
    const st = b.soup.surfaceTypes;

    const pushVertex = (acc: Accum, v: number): void => {
      acc.positions.push(pos[3 * v] + east, pos[3 * v + 1] + north, pos[3 * v + 2]);
      acc.normals.push(nrm[3 * v], nrm[3 * v + 1], nrm[3 * v + 2]);
    };

    // Every 3 consecutive indices form a triangle. Classify via the first
    // vertex's surface type — within a single CityJSON surface all three
    // always share the same type.
    for (let t = 0; t < idx.length; t += 3) {
      const i0 = idx[t];
      const i1 = idx[t + 1];
      const i2 = idx[t + 2];
      const isRoof = st.length > 0 && st[i0] === SURFACE_TYPE_ROOF;
      const bucket =
        isRoof && mat !== null
          ? (byMaterial.get(mat) ??
            (() => {
              const a: Accum = { positions: [], normals: [] };
              byMaterial.set(mat, a);
              return a;
            })())
          : body;
      pushVertex(bucket, i0);
      pushVertex(bucket, i1);
      pushVertex(bucket, i2);
    }
  }

  const toSoup = (a: Accum): TriangleSoup => {
    const n = a.positions.length / 3;
    const indices = new Uint32Array(n);
    for (let i = 0; i < n; i++) indices[i] = i;
    return {
      positions: new Float32Array(a.positions),
      normals: new Float32Array(a.normals),
      indices,
      surfaceTypes: new Int32Array(0),
    };
  };

  const roofsByMaterial = new Map<M, TriangleSoup>();
  for (const [m, a] of byMaterial) {
    if (a.positions.length > 0) roofsByMaterial.set(m, toSoup(a));
  }
  return { body: toSoup(body), roofsByMaterial };
}
