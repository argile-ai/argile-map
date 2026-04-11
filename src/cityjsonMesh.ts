/**
 * Parse a CityJSON building into a set of triangles (positions + normals +
 * indices) in local meters, ready to be merged into a deck.gl SimpleMeshLayer.
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
 *
 * The `mergeBuildings` function is defined in `./mergeBuildings` so it can be
 * unit-tested without importing the loader (whose ESM imports omit `.js`
 * extensions and break Vitest's strict resolver).
 */

// Import directly from the parser subpath to avoid pulling the worker-based
// parser, which drags in `regenerator-runtime` (unresolvable in Vite).
// biome-ignore lint/correctness/noUndeclaredDependencies: subpath of a declared dep
import { CityJSONParser } from "cityjson-threejs-loader/src/parsers/CityJSONParser.js";
import * as THREE from "three";
import {
  lambert93Convergence,
  type ParsedBuilding,
  type TriangleSoup,
} from "./mergeBuildings";
import type { CityJsonBuilding } from "./types";

export { mergeBuildings, rotateLambert93ToEastNorth } from "./mergeBuildings";
export type { ParsedBuilding, TriangleSoup } from "./mergeBuildings";

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

    const posAttr = geom.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!posAttr) return;
    if (!geom.getAttribute("normal")) {
      geom.computeVertexNormals();
    }
    const normAttr = geom.getAttribute("normal") as THREE.BufferAttribute;

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

  // The loader preserves raw integer vertices — it doesn't apply the
  // `transform.scale` / `transform.translate` convention from CityJSON v2.0.
  // Apply the scale ourselves so we end up in Lambert93 meters. We skip
  // translate because the re-center step below subtracts the bbox center.
  const scale = building.cityjson.transform?.scale ?? [1, 1, 1];
  if (scale[0] !== 1 || scale[1] !== 1 || scale[2] !== 1) {
    for (let i = 0; i < soup.positions.length; i += 3) {
      soup.positions[i] *= scale[0];
      soup.positions[i + 1] *= scale[1];
      soup.positions[i + 2] *= scale[2];
    }
  }

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

  // After this loop, (x, y, z) is a Lambert93-local delta around the
  // building's bbox center with z=0 at the ground. We THEN rotate (x, y)
  // from Lambert93 axes to WGS84 East/North via the meridian convergence γ
  // so deck.gl can render the mesh with COORDINATE_SYSTEM.METER_OFFSETS.
  const gamma = lambert93Convergence(building.lng);
  const cosG = Math.cos(gamma);
  const sinG = Math.sin(gamma);
  for (let i = 0; i < soup.positions.length; i += 3) {
    const x = soup.positions[i] - cx;
    const y = soup.positions[i + 1] - cy;
    const z = soup.positions[i + 2] - minZ;
    soup.positions[i] = x * cosG + y * sinG;
    soup.positions[i + 1] = -x * sinG + y * cosG;
    soup.positions[i + 2] = z;
  }
  for (let i = 0; i < soup.normals.length; i += 3) {
    const nx = soup.normals[i];
    const ny = soup.normals[i + 1];
    soup.normals[i] = nx * cosG + ny * sinG;
    soup.normals[i + 1] = -nx * sinG + ny * cosG;
  }

  return {
    geopf_id: building.geopf_id,
    lat: building.lat,
    lng: building.lng,
    soup,
    height: Math.max(0, maxZ - minZ),
  };
}
