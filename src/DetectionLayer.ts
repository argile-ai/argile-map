/**
 * deck.gl layer that renders AI-detected roof features as colored 3D panels
 * on each building's CityJSON roof surface.
 *
 * For each detection with geo bboxes, we:
 *   1. Match it to the closest ParsedBuilding by lat/lng proximity
 *   2. Convert the detection's geo center to the building's local meter frame
 *   3. Find the roof triangle containing that XY point (barycentric test)
 *   4. Interpolate Z + get the triangle's normal
 *   5. Build a coordinate frame (normal + slope-down + right) so the panel
 *      lies flat on the roof slope — matching argile-web-ui's approach
 *   6. Merge all panels into one SimpleMeshLayer per label (single draw call)
 */

import { COORDINATE_SYSTEM } from "@deck.gl/core";
import { SimpleMeshLayer } from "@deck.gl/mesh-layers";
import type { DeckMesh } from "./BuildingLayer";
import type { ParsedBuilding, TriangleSoup } from "./mergeBuildings";
import type { Detection } from "./types";

const SURFACE_OFFSET = 0.05; // meters above roof surface

/** Colors per label (RGBA 0-255). */
function colorForLabel(label: string): [number, number, number, number] {
  switch (label) {
    case "roof window":
      return [80, 160, 255, 230];
    case "photovoltaic solar panel":
      return [255, 170, 30, 230];
    case "chimney":
      return [180, 180, 180, 230];
    default:
      return [200, 200, 200, 200];
  }
}

// -- Roof triangle lookup (ported from argile-web-ui createRoofWindowOverlayMesh.ts) --

const SURFACE_TYPE_ROOF = 2;

/** Extract only roof triangle positions from a ParsedBuilding's soup. */
function extractRoofPositions(b: ParsedBuilding): Float32Array {
  const positions: number[] = [];
  const { soup } = b;
  // The soup uses indexed triangles; walk the index buffer in groups of 3.
  for (let i = 0; i < soup.indices.length; i += 3) {
    const i0 = soup.indices[i];
    const i1 = soup.indices[i + 1];
    const i2 = soup.indices[i + 2];
    // All 3 vertices of a roof triangle must have surfacetype == 2.
    if (
      soup.surfaceTypes[i0] !== SURFACE_TYPE_ROOF ||
      soup.surfaceTypes[i1] !== SURFACE_TYPE_ROOF ||
      soup.surfaceTypes[i2] !== SURFACE_TYPE_ROOF
    )
      continue;
    positions.push(
      soup.positions[i0 * 3], soup.positions[i0 * 3 + 1], soup.positions[i0 * 3 + 2],
      soup.positions[i1 * 3], soup.positions[i1 * 3 + 1], soup.positions[i1 * 3 + 2],
      soup.positions[i2 * 3], soup.positions[i2 * 3 + 1], soup.positions[i2 * 3 + 2],
    );
  }
  return new Float32Array(positions);
}

/** Compute the face normal of a triangle (9 consecutive floats). */
function triangleNormal(
  roof: Float32Array,
  base: number,
): [number, number, number] {
  const e1x = roof[base + 3] - roof[base];
  const e1y = roof[base + 4] - roof[base + 1];
  const e1z = roof[base + 5] - roof[base + 2];
  const e2x = roof[base + 6] - roof[base];
  const e2y = roof[base + 7] - roof[base + 1];
  const e2z = roof[base + 8] - roof[base + 2];
  let nx = e1y * e2z - e1z * e2y;
  let ny = e1z * e2x - e1x * e2z;
  let nz = e1x * e2y - e1y * e2x;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len;
  ny /= len;
  nz /= len;
  // Ensure normal points upward (z > 0).
  if (nz < 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  return [nx, ny, nz];
}

type RoofHit = {
  z: number;
  normal: [number, number, number];
};

/**
 * Find the roof triangle containing (x, y) via 2D barycentric test.
 * Returns interpolated Z and the triangle's face normal.
 * Falls back to nearest vertex / nearest centroid if no triangle contains
 * the point (edge cases from imprecise detection coords).
 */
function findRoofSurfaceAt(
  x: number,
  y: number,
  roof: Float32Array,
): RoofHit | null {
  const triCount = roof.length / 9;
  if (triCount === 0) return null;

  // Pass 1: exact barycentric hit
  for (let t = 0; t < triCount; t++) {
    const b = t * 9;
    const ax = roof[b], ay = roof[b + 1], az = roof[b + 2];
    const bx = roof[b + 3], by = roof[b + 4], bz = roof[b + 5];
    const cx = roof[b + 6], cy = roof[b + 7], cz = roof[b + 8];

    const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(denom) < 1e-10) continue;

    const u = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / denom;
    const v = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / denom;
    const w = 1 - u - v;

    if (u >= -0.05 && v >= -0.05 && w >= -0.05) {
      return {
        z: u * az + v * bz + w * cz,
        normal: triangleNormal(roof, b),
      };
    }
  }

  // Pass 2: fallback — nearest centroid
  let bestDist = Infinity;
  let bestZ = 0;
  let bestNormal: [number, number, number] = [0, 0, 1];
  for (let t = 0; t < triCount; t++) {
    const b = t * 9;
    const centX = (roof[b] + roof[b + 3] + roof[b + 6]) / 3;
    const centY = (roof[b + 1] + roof[b + 4] + roof[b + 7]) / 3;
    const centZ = (roof[b + 2] + roof[b + 5] + roof[b + 8]) / 3;
    const dist = (centX - x) ** 2 + (centY - y) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      bestZ = centZ;
      bestNormal = triangleNormal(roof, b);
    }
  }
  return { z: bestZ, normal: bestNormal };
}

/**
 * Build a local coordinate frame on the roof surface:
 *   - normal: the triangle's face normal (pointing up)
 *   - slopeDown: gravity projected onto the roof plane (down-slope direction)
 *   - right: cross(normal, slopeDown)
 *
 * Ported from argile-web-ui calculateRoofCoordinateSystem.
 */
function roofFrame(n: [number, number, number]): {
  right: [number, number, number];
  slopeDown: [number, number, number];
} {
  // Gravity in the local frame = -Z (CityJSON is Z-up after our transform).
  // Project gravity onto the roof plane to get the slope-down direction.
  const dot = -n[2]; // gravity · normal = (0,0,-1) · n = -n[2]
  let sdx = 0 - n[0] * dot;
  let sdy = 0 - n[1] * dot;
  let sdz = -1 - n[2] * dot;
  let sdLen = Math.hypot(sdx, sdy, sdz);

  // Flat roof: fallback to Y projected onto the roof plane.
  if (sdLen < 1e-6) {
    const d = n[1]; // (0,1,0) · n
    sdx = -n[0] * d;
    sdy = 1 - n[1] * d;
    sdz = -n[2] * d;
    sdLen = Math.hypot(sdx, sdy, sdz) || 1;
  }
  sdx /= sdLen;
  sdy /= sdLen;
  sdz /= sdLen;

  // right = normal × slopeDown
  const rx = n[1] * sdz - n[2] * sdy;
  const ry = n[2] * sdx - n[0] * sdz;
  const rz = n[0] * sdy - n[1] * sdx;
  const rLen = Math.hypot(rx, ry, rz) || 1;

  return {
    right: [rx / rLen, ry / rLen, rz / rLen],
    slopeDown: [sdx, sdy, sdz],
  };
}

// -- Quad builder using the roof coordinate frame --

function buildRoofQuad(
  center: [number, number, number],
  normal: [number, number, number],
  halfW: number,
  halfH: number,
): { positions: number[]; normals: number[]; indices: number[] } {
  const { right: r, slopeDown: sd } = roofFrame(normal);

  // Offset slightly above the roof surface along the normal.
  const cx = center[0] + normal[0] * SURFACE_OFFSET;
  const cy = center[1] + normal[1] * SURFACE_OFFSET;
  const cz = center[2] + normal[2] * SURFACE_OFFSET;

  // 4 corners: ±halfW along right, ±halfH along slopeDown
  const positions: number[] = [];
  for (const [sw, sh] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    positions.push(
      cx + r[0] * halfW * sw + sd[0] * halfH * sh,
      cy + r[1] * halfW * sw + sd[1] * halfH * sh,
      cz + r[2] * halfW * sw + sd[2] * halfH * sh,
    );
  }
  const normals = [
    normal[0], normal[1], normal[2],
    normal[0], normal[1], normal[2],
    normal[0], normal[1], normal[2],
    normal[0], normal[1], normal[2],
  ];
  const indices = [0, 1, 2, 0, 2, 3];
  return { positions, normals, indices };
}

// -- Matching + merging --

type MatchedDetection = {
  detection: Detection;
  building: ParsedBuilding;
};

function matchDetections(
  detections: Detection[],
  buildings: ParsedBuilding[],
): MatchedDetection[] {
  if (buildings.length === 0) return [];
  const matched: MatchedDetection[] = [];
  for (const det of detections) {
    let best: ParsedBuilding | null = null;
    let bestDist = Infinity;
    for (const b of buildings) {
      const dLat = det.center_lat - b.lat;
      const dLng = det.center_lon - b.lng;
      const d = dLat * dLat + dLng * dLng;
      if (d < bestDist) {
        bestDist = d;
        best = b;
      }
    }
    if (best && bestDist < 0.0005 * 0.0005) {
      matched.push({ detection: det, building: best });
    }
  }
  return matched;
}

function buildDetectionMesh(
  matched: MatchedDetection[],
  origin: { lat: number; lng: number },
): TriangleSoup {
  const R = 6_378_137;
  const latRad = (origin.lat * Math.PI) / 180;
  const mPerDegLat = (Math.PI * R) / 180;
  const mPerDegLng = mPerDegLat * Math.cos(latRad);

  const allPos: number[] = [];
  const allNrm: number[] = [];
  const allIdx: number[] = [];
  let vOffset = 0;

  // Cache roof positions per building.
  const roofCache = new Map<string, Float32Array>();

  for (const m of matched) {
    const b = m.building;
    const det = m.detection;

    // Get the detection's WGS84 center. Prefer geo bbox if available.
    let detLng: number;
    let detLat: number;
    if (det.geo_xmin != null && det.geo_xmax != null && det.geo_ymin != null && det.geo_ymax != null) {
      detLng = (det.geo_xmin + det.geo_xmax) / 2;
      detLat = (det.geo_ymin + det.geo_ymax) / 2;
    } else {
      // Fallback: building centroid (clustered but visible).
      detLng = det.center_lon;
      detLat = det.center_lat;
    }

    // Convert the detection's WGS84 position to the building's local frame
    // (east/north meters from the building's centroid).
    const localX = (detLng - b.lng) * mPerDegLng;
    const localY = (detLat - b.lat) * mPerDegLat;

    // Get or compute roof triangles for this building.
    let roof = roofCache.get(b.geopf_id);
    if (roof === undefined) {
      roof = extractRoofPositions(b);
      roofCache.set(b.geopf_id, roof);
    }

    // Find the roof triangle at this XY and get its Z + normal.
    const hit = findRoofSurfaceAt(localX, localY, roof);
    if (!hit) continue;

    // Detection size from geo bbox (meters), or fixed default.
    let halfW = 0.5;
    let halfH = 0.4;
    if (det.geo_xmin != null && det.geo_xmax != null && det.geo_ymin != null && det.geo_ymax != null) {
      halfW = Math.max(0.2, ((det.geo_xmax - det.geo_xmin) * mPerDegLng) / 2);
      halfH = Math.max(0.2, ((det.geo_ymax - det.geo_ymin) * mPerDegLat) / 2);
    }

    // Build the quad in the building's local frame, then offset to the
    // merged frame (building lng/lat → origin lng/lat).
    const east = (b.lng - origin.lng) * mPerDegLng;
    const north = (b.lat - origin.lat) * mPerDegLat;

    const center: [number, number, number] = [
      localX + east,
      localY + north,
      hit.z,
    ];

    const quad = buildRoofQuad(center, hit.normal, halfW, halfH);
    for (const p of quad.positions) allPos.push(p);
    for (const n of quad.normals) allNrm.push(n);
    for (const idx of quad.indices) allIdx.push(idx + vOffset);
    vOffset += 4;
  }

  return {
    positions: new Float32Array(allPos),
    normals: new Float32Array(allNrm),
    indices: new Uint32Array(allIdx),
    surfaceTypes: new Int32Array(0),
  };
}

type InstanceDatum = { position: [number, number, number] };
const LABEL_GROUPS = ["roof window", "photovoltaic solar panel", "chimney"] as const;

export function createDetectionLayer(
  detections: Detection[],
  buildings: ParsedBuilding[],
  origin: { lat: number; lng: number } | null,
): SimpleMeshLayer<InstanceDatum>[] {
  if (detections.length === 0 || buildings.length === 0 || !origin) return [];

  const matched = matchDetections(detections, buildings);
  if (matched.length === 0) return [];

  const layers: SimpleMeshLayer<InstanceDatum>[] = [];

  for (const label of LABEL_GROUPS) {
    const subset = matched.filter((m) => m.detection.label === label);
    if (subset.length === 0) continue;

    const soup = buildDetectionMesh(subset, origin);
    if (soup.positions.length === 0) continue;

    const mesh: DeckMesh = {
      attributes: {
        positions: { value: soup.positions, size: 3 },
        normals: { value: soup.normals, size: 3 },
      },
      indices: { value: soup.indices, size: 1 },
    };

    layers.push(
      new SimpleMeshLayer<InstanceDatum>({
        id: `argile-det-${label.replace(/\s+/g, "-")}`,
        data: [{ position: [0, 0, 0] }],
        mesh,
        coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
        coordinateOrigin: [origin.lng, origin.lat, 0],
        getPosition: (d) => d.position,
        getColor: colorForLabel(label),
        material: {
          ambient: 0.5,
          diffuse: 0.7,
          shininess: 16,
          specularColor: [255, 255, 255],
        },
        pickable: false,
      }),
    );
  }

  return layers;
}
