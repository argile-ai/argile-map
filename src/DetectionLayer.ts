/**
 * deck.gl layer that renders AI-detected roof features as colored 3D panels
 * on each building's CityJSON roof surface.
 *
 * For each detection, we:
 *   1. Match it to the closest ParsedBuilding by lat/lng proximity
 *   2. Use that building's roofCentroid + roofNormal (computed during parse)
 *   3. Create a small colored quad oriented along the roof surface
 *   4. Merge all panels into one SimpleMeshLayer (single draw call)
 *
 * Without georeferenced detection bboxes (the current sat DB only has pixel
 * bboxes), all panels for a given building sit near the roof centroid, offset
 * slightly to avoid z-fighting. Once the backend re-imports with geo_*
 * fields, we can place each panel at its real lat/lng on the roof.
 */

import { COORDINATE_SYSTEM } from "@deck.gl/core";
import { SimpleMeshLayer } from "@deck.gl/mesh-layers";
import type { DeckMesh } from "./BuildingLayer";
import type { ParsedBuilding, TriangleSoup } from "./mergeBuildings";
import type { Detection } from "./types";

const PANEL_HALF_W = 0.6; // meters (half-width of the panel quad)
const PANEL_HALF_H = 0.4;

/** Colors per label (RGBA 0-255). Used for getColor on the merged layer. */
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

type MatchedDetection = {
  detection: Detection;
  building: ParsedBuilding;
};

/**
 * Match each detection to the closest parsed building by centroid distance.
 * Detection building_id ≠ geopf_id (different datasets), so we use geo
 * proximity instead of key equality.
 */
function matchDetections(
  detections: Detection[],
  buildings: ParsedBuilding[],
): MatchedDetection[] {
  if (buildings.length === 0) return [];
  const matched: MatchedDetection[] = [];
  for (const det of detections) {
    let best: ParsedBuilding | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const b of buildings) {
      const dLat = det.center_lat - b.lat;
      const dLng = det.center_lon - b.lng;
      const d = dLat * dLat + dLng * dLng;
      if (d < bestDist) {
        bestDist = d;
        best = b;
      }
    }
    // Only match if the building is within ~50 m (≈0.0005°)
    if (best && bestDist < 0.0005 * 0.0005) {
      matched.push({ detection: det, building: best });
    }
  }
  return matched;
}

/**
 * Build a single quad (2 triangles, 4 vertices) oriented to the roof
 * surface at `center` with normal `normal`, offset slightly above the roof.
 * Returns positions (12 floats), normals (12 floats), indices (6 ints).
 */
function buildQuad(
  center: [number, number, number],
  normal: [number, number, number],
  halfW: number,
  halfH: number,
  stackOffset: number,
): { positions: number[]; normals: number[]; indices: number[] } {
  // Build a local coordinate frame on the roof: `up` = normal,
  // `right` and `forward` lie on the surface.
  const [nx, ny, nz] = normal;
  // Pick an arbitrary vector NOT parallel to the normal to derive `right`.
  const ax = Math.abs(nx) < 0.9 ? 1 : 0;
  const ay = Math.abs(nx) < 0.9 ? 0 : 1;
  // right = normalize(arbitrary × normal)
  let rx = ay * nz - 0 * ny;
  let ry = 0 * nx - ax * nz;
  let rz = ax * ny - ay * nx;
  const rLen = Math.hypot(rx, ry, rz) || 1;
  rx /= rLen;
  ry /= rLen;
  rz /= rLen;
  // forward = normal × right
  const fx = ny * rz - nz * ry;
  const fy = nz * rx - nx * rz;
  const fz = nx * ry - ny * rx;

  // Offset above the roof surface to avoid z-fighting
  const off = 0.05 + stackOffset * 0.08;
  const cx = center[0] + nx * off;
  const cy = center[1] + ny * off;
  const cz = center[2] + nz * off;

  // 4 corners: ±halfW along right, ±halfH along forward
  const positions: number[] = [];
  for (const [sw, sh] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    positions.push(
      cx + rx * halfW * sw + fx * halfH * sh,
      cy + ry * halfW * sw + fy * halfH * sh,
      cz + rz * halfW * sw + fz * halfH * sh,
    );
  }
  const normals = [nx, ny, nz, nx, ny, nz, nx, ny, nz, nx, ny, nz];
  const indices = [0, 1, 2, 0, 2, 3];
  return { positions, normals, indices };
}

/**
 * Build a merged mesh of detection panels for all matched detections,
 * baked into the same meter-offset frame as the buildings.
 */
function buildDetectionMesh(
  matched: MatchedDetection[],
  origin: { lat: number; lng: number },
): TriangleSoup {
  const R = 6_378_137;
  const latRad = (origin.lat * Math.PI) / 180;
  const mPerDegLat = (Math.PI * R) / 180;
  const mPerDegLng = mPerDegLat * Math.cos(latRad);

  // Group by building to stack panels
  const byBuilding = new Map<string, MatchedDetection[]>();
  for (const m of matched) {
    const bucket = byBuilding.get(m.building.geopf_id);
    if (bucket) bucket.push(m);
    else byBuilding.set(m.building.geopf_id, [m]);
  }

  const allPos: number[] = [];
  const allNrm: number[] = [];
  const allIdx: number[] = [];
  let vOffset = 0;

  for (const bucket of byBuilding.values()) {
    const b = bucket[0].building;
    if (!b.roofCentroid || !b.roofNormal) continue;

    const east = (b.lng - origin.lng) * mPerDegLng;
    const north = (b.lat - origin.lat) * mPerDegLat;

    // Roof centroid in the merged frame
    const rc: [number, number, number] = [
      b.roofCentroid[0] + east,
      b.roofCentroid[1] + north,
      b.roofCentroid[2],
    ];

    // Sort by score descending so best-confidence panels are closest to roof
    bucket.sort((a, b) => b.detection.score - a.detection.score);

    for (let i = 0; i < bucket.length; i++) {
      const det = bucket[i].detection;
      const hw = det.label === "photovoltaic solar panel" ? PANEL_HALF_W * 1.5 : PANEL_HALF_W;
      const hh = det.label === "chimney" ? PANEL_HALF_H * 0.7 : PANEL_HALF_H;

      // Offset each panel slightly along the roof tangent plane so they
      // don't overlap. Spiral outward from the centroid.
      const angle = (i * 2.4); // golden angle spacing
      const radius = i * 0.3;
      const offset: [number, number, number] = [
        rc[0] + Math.cos(angle) * radius,
        rc[1] + Math.sin(angle) * radius,
        rc[2],
      ];

      const quad = buildQuad(offset, b.roofNormal, hw, hh, i);
      for (const p of quad.positions) allPos.push(p);
      for (const n of quad.normals) allNrm.push(n);
      for (const idx of quad.indices) allIdx.push(idx + vOffset);
      vOffset += 4; // 4 vertices per quad
    }
  }

  return {
    positions: new Float32Array(allPos),
    normals: new Float32Array(allNrm),
    indices: new Uint32Array(allIdx),
    surfaceTypes: new Int32Array(0), // unused for detections
  };
}

type InstanceDatum = { position: [number, number, number] };

const LABEL_GROUPS = ["roof window", "photovoltaic solar panel", "chimney"] as const;

/**
 * Create one SimpleMeshLayer per detection label (different colors). Returns
 * an array so the caller can spread them into the deck.gl layer list.
 */
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
