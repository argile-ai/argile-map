/**
 * Parse a CityJSON building into a set of triangles (positions + normals +
 * indices) in local meters. The result is ready to be merged into a deck.gl
 * SimpleMeshLayer.
 *
 * We use cityjson-threejs-loader (same parser as argile-web-ui) because
 * CityJSON boundaries are hierarchical (Solid → Shell → Surface → Ring →
 * vertex indices) and need triangulation. The loader handles this, plus the
 * transform.scale / transform.translate convention.
 *
 * Coordinate system: CityJSON stores vertices in East/North/Up (meters) after
 * applying the transform. The loader builds a THREE.BufferGeometry that
 * preserves this layout. We do NOT rotate to Y-up: deck.gl uses Z-up for
 * geographic data, which matches CityJSON directly.
 */

// Import directly from the parser subpath to avoid pulling the worker-based
// parser, which drags in `regenerator-runtime` (unresolvable in Vite).
// biome-ignore lint/correctness/noUndeclaredDependencies: subpath of a declared dep
import { CityJSONParser } from "cityjson-threejs-loader/src/parsers/CityJSONParser.js";
import * as THREE from "three";
import type { CityJsonBuilding } from "./types";

export type TriangleSoup = {
  /** (east, north, up) in meters, relative to the building's local origin. */
  positions: Float32Array;
  /** per-vertex normal, same layout as positions */
  normals: Float32Array;
  /** triangle indices into positions/normals */
  indices: Uint32Array;
};

/** Extract the merged triangle soup from every Mesh inside a THREE.Group. */
function extractTriangleSoup(root: THREE.Object3D): TriangleSoup | null {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let vertexOffset = 0;

  root.updateMatrixWorld(true);

  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const geom = obj.geometry as THREE.BufferGeometry | null;
    if (!geom) return;

    // Make sure we have both positions and normals. If the loader didn't emit
    // normals, compute them here.
    const posAttr = geom.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!posAttr) return;
    if (!geom.getAttribute("normal")) {
      geom.computeVertexNormals();
    }
    const normAttr = geom.getAttribute("normal") as THREE.BufferAttribute;

    // Apply any parent transforms baked into obj.matrixWorld so vertices end
    // up in the root group's frame.
    const m = obj.matrixWorld;
    const v = new THREE.Vector3();
    const n = new THREE.Vector3();
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(m);

    for (let i = 0; i < posAttr.count; i++) {
      v.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)).applyMatrix4(m);
      positions.push(v.x, v.y, v.z);
      n.set(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i))
        .applyMatrix3(normalMatrix)
        .normalize();
      normals.push(n.x, n.y, n.z);
    }

    const idx = geom.getIndex();
    if (idx) {
      for (let i = 0; i < idx.count; i++) indices.push(idx.getX(i) + vertexOffset);
    } else {
      for (let i = 0; i < posAttr.count; i++) indices.push(i + vertexOffset);
    }
    vertexOffset += posAttr.count;
  });

  if (indices.length === 0) return null;

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
}

export type ParsedBuilding = {
  geopf_id: string;
  /** WGS84 centroid of the building, used as the anchor for the local frame. */
  lat: number;
  lng: number;
  /** Triangle soup in local meters (east/north/up). Positions are re-centered
   *  so that x=y=0 sits at the building's footprint centroid. */
  soup: TriangleSoup;
  /** Height above local Z-origin of the highest triangle, for UI / culling. */
  height: number;
};

/**
 * Parse a CityJSON building into a ready-to-merge triangle soup. Returns null
 * on parse failure (rare: only for malformed CityJSON).
 */
export function parseBuilding(building: CityJsonBuilding): ParsedBuilding | null {
  const group = new THREE.Group();
  try {
    const parser = new CityJSONParser();
    // Signature: parser.parse(cityjson, scene). The parser appends
    // CityObjectsMesh instances directly into `scene`.
    // biome-ignore lint/suspicious/noExplicitAny: untyped GitHub build.
    (parser as any).parse(building.cityjson, group);
  } catch (err) {
    console.warn("CityJSON parse failed for", building.geopf_id, err);
    return null;
  }

  const soup = extractTriangleSoup(group);
  if (!soup) return null;

  // Re-center horizontally at (0,0) and put the ground at z=0. The loader
  // emits vertices in an arbitrary local frame that depends on the building's
  // transform.translate — we don't rely on its absolute value.
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < soup.positions.length; i += 3) {
    const x = soup.positions[i];
    const y = soup.positions[i + 1];
    const z = soup.positions[i + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  for (let i = 0; i < soup.positions.length; i += 3) {
    soup.positions[i] -= cx;
    soup.positions[i + 1] -= cy;
    soup.positions[i + 2] -= minZ;
  }

  return {
    geopf_id: building.geopf_id,
    lat: building.lat,
    lng: building.lng,
    soup,
    height: Math.max(0, maxZ - minZ),
  };
}

/**
 * Merge N parsed buildings into a single triangle soup, baking each building's
 * (lng, lat) offset into the vertex positions. The resulting soup is expressed
 * in meters relative to `origin` (a lng/lat anchor).
 *
 * This lets us render the whole visible city with a SINGLE deck.gl draw call.
 */
export function mergeBuildings(
  buildings: ParsedBuilding[],
  origin: { lat: number; lng: number },
): TriangleSoup {
  // Flat-earth approximation: at Paris latitude, the error over 1 km is ~1 mm.
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
