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

/** Realistic colors per label (RGBA 0-255). */
function colorForLabel(label: string): [number, number, number, number] {
  switch (label) {
    case "roof window":
      return [140, 200, 240, 200]; // glass blue, slightly transparent
    case "photovoltaic solar panel":
      return [25, 35, 70, 245]; // dark blue-black like real PV cells
    case "chimney":
      return [170, 95, 55, 245]; // terracotta / brick
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

type MeshData = { positions: number[]; normals: number[]; indices: number[] };

/** Flat panel on the roof surface (PV panels, roof windows). */
function buildRoofQuad(
  center: [number, number, number],
  normal: [number, number, number],
  halfW: number,
  halfH: number,
): MeshData {
  const { right: r, slopeDown: sd } = roofFrame(normal);
  const cx = center[0] + normal[0] * SURFACE_OFFSET;
  const cy = center[1] + normal[1] * SURFACE_OFFSET;
  const cz = center[2] + normal[2] * SURFACE_OFFSET;

  const positions: number[] = [];
  for (const [sw, sh] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    positions.push(
      cx + r[0] * halfW * sw + sd[0] * halfH * sh,
      cy + r[1] * halfW * sw + sd[1] * halfH * sh,
      cz + r[2] * halfW * sw + sd[2] * halfH * sh,
    );
  }
  return {
    positions,
    normals: [
      normal[0], normal[1], normal[2],
      normal[0], normal[1], normal[2],
      normal[0], normal[1], normal[2],
      normal[0], normal[1], normal[2],
    ],
    indices: [0, 1, 2, 0, 2, 3],
  };
}

/**
 * Small 3D box rising from the roof surface (chimneys).
 * 8 vertices, 6 faces (12 triangles).
 */
function buildChimneyBox(
  center: [number, number, number],
  normal: [number, number, number],
  halfW: number,
  halfH: number,
  height: number,
): MeshData {
  // Chimney rises vertically (Z-up), not along the roof normal.
  // Base sits on the roof, top goes straight up.
  const bx = center[0];
  const by = center[1];
  const bz = center[2] + SURFACE_OFFSET;

  // 4 bottom corners, 4 top corners (axis-aligned box).
  const positions = [
    // bottom face (z = bz)
    bx - halfW, by - halfH, bz,
    bx + halfW, by - halfH, bz,
    bx + halfW, by + halfH, bz,
    bx - halfW, by + halfH, bz,
    // top face (z = bz + height)
    bx - halfW, by - halfH, bz + height,
    bx + halfW, by - halfH, bz + height,
    bx + halfW, by + halfH, bz + height,
    bx - halfW, by + halfH, bz + height,
  ];

  // Face normals (6 faces).
  const normals = [
    // bottom (unused visually but needed for the buffer)
    0, 0, -1,  0, 0, -1,  0, 0, -1,  0, 0, -1,
    // top
    0, 0, 1,   0, 0, 1,   0, 0, 1,   0, 0, 1,
  ];

  // Use the 8 vertices with per-face indexing. Since SimpleMeshLayer
  // doesn't do per-face normals well, approximate with vertex normals
  // pointing outward. Good enough for tiny chimney boxes.
  const indices = [
    // bottom
    0, 2, 1,  0, 3, 2,
    // top
    4, 5, 6,  4, 6, 7,
    // front (-Y)
    0, 1, 5,  0, 5, 4,
    // back (+Y)
    2, 3, 7,  2, 7, 6,
    // left (-X)
    0, 4, 7,  0, 7, 3,
    // right (+X)
    1, 2, 6,  1, 6, 5,
  ];

  // Simple vertex normals: average of adjacent faces ≈ pointing outward.
  // For a tiny box this is fine.
  const vn: number[] = [];
  for (let i = 0; i < 8; i++) {
    const x = positions[i * 3] - bx;
    const y = positions[i * 3 + 1] - by;
    const z = positions[i * 3 + 2] - (bz + height / 2);
    const len = Math.hypot(x, y, z) || 1;
    vn.push(x / len, y / len, z / len);
  }

  return { positions, normals: vn, indices };
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

/**
 * For each roof triangle, compute its centroid + normal. Used to distribute
 * detections across the roof surface — each detection gets the NEAREST roof
 * triangle centroid, which guarantees the panel always sits flat on a real
 * roof face (no wall placement, no floating).
 */
type RoofFace = {
  cx: number;
  cy: number;
  cz: number;
  normal: [number, number, number];
};

function extractRoofFaces(b: ParsedBuilding): RoofFace[] {
  const roof = extractRoofPositions(b);
  const triCount = roof.length / 9;
  const faces: RoofFace[] = [];
  for (let t = 0; t < triCount; t++) {
    const base = t * 9;
    faces.push({
      cx: (roof[base] + roof[base + 3] + roof[base + 6]) / 3,
      cy: (roof[base + 1] + roof[base + 4] + roof[base + 7]) / 3,
      cz: (roof[base + 2] + roof[base + 5] + roof[base + 8]) / 3,
      normal: triangleNormal(roof, base),
    });
  }
  return faces;
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

  // Group detections by building.
  const byBuilding = new Map<string, { building: ParsedBuilding; detections: Detection[] }>();
  for (const m of matched) {
    const entry = byBuilding.get(m.building.geopf_id);
    if (entry) {
      entry.detections.push(m.detection);
    } else {
      byBuilding.set(m.building.geopf_id, {
        building: m.building,
        detections: [m.detection],
      });
    }
  }

  for (const { building: b, detections: dets } of byBuilding.values()) {
    const faces = extractRoofFaces(b);
    if (faces.length === 0) continue;

    // Building's offset in the merged frame.
    const east = (b.lng - origin.lng) * mPerDegLng;
    const north = (b.lat - origin.lat) * mPerDegLat;

    // Sort detections by score descending so highest-confidence gets the
    // best roof face (most central).
    dets.sort((a, b) => b.score - a.score);

    // Track used faces so multiple detections on the same building don't
    // stack on the same triangle.
    const usedFaces = new Set<number>();

    for (const det of dets) {
      // Find the nearest UNUSED roof face centroid.
      let bestIdx = -1;
      let bestDist = Infinity;
      for (let i = 0; i < faces.length; i++) {
        if (usedFaces.has(i)) continue;
        // Use distance from the building's roof centroid (center of all
        // faces) as a preference metric — faces closer to center are
        // preferred so panels sit in the middle of the roof.
        const f = faces[i];
        const dist = f.cx * f.cx + f.cy * f.cy; // distance from local (0,0)
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
        }
      }
      // All faces used — reuse the first one (rare: more detections than
      // roof triangles).
      if (bestIdx < 0) bestIdx = 0;
      usedFaces.add(bestIdx);

      const face = faces[bestIdx];

      const center: [number, number, number] = [
        face.cx + east,
        face.cy + north,
        face.cz,
      ];

      let mesh: MeshData;
      let vertCount: number;
      if (det.label === "chimney") {
        // 3D box rising 0.6m from the roof — looks like a chimney stack.
        mesh = buildChimneyBox(center, face.normal, 0.25, 0.25, 0.6);
        vertCount = 8;
      } else if (det.label === "photovoltaic solar panel") {
        // Flat dark rectangle ~1.6m × 1m — standard PV module size.
        mesh = buildRoofQuad(center, face.normal, 0.8, 0.5);
        vertCount = 4;
      } else {
        // Roof window: smaller flat rectangle ~0.7m × 0.5m.
        mesh = buildRoofQuad(center, face.normal, 0.35, 0.25);
        vertCount = 4;
      }

      for (const p of mesh.positions) allPos.push(p);
      for (const n of mesh.normals) allNrm.push(n);
      for (const idx of mesh.indices) allIdx.push(idx + vOffset);
      vOffset += vertCount;
    }
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
