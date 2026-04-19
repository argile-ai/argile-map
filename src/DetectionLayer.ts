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
      soup.positions[i0 * 3],
      soup.positions[i0 * 3 + 1],
      soup.positions[i0 * 3 + 2],
      soup.positions[i1 * 3],
      soup.positions[i1 * 3 + 1],
      soup.positions[i1 * 3 + 2],
      soup.positions[i2 * 3],
      soup.positions[i2 * 3 + 1],
      soup.positions[i2 * 3 + 2],
    );
  }
  return new Float32Array(positions);
}

/** Compute the face normal of a triangle (9 consecutive floats). */
function triangleNormal(roof: Float32Array, base: number): [number, number, number] {
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
  for (const [sw, sh] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    positions.push(
      cx + r[0] * halfW * sw + sd[0] * halfH * sh,
      cy + r[1] * halfW * sw + sd[1] * halfH * sh,
      cz + r[2] * halfW * sw + sd[2] * halfH * sh,
    );
  }
  return {
    positions,
    normals: [
      normal[0],
      normal[1],
      normal[2],
      normal[0],
      normal[1],
      normal[2],
      normal[0],
      normal[1],
      normal[2],
      normal[0],
      normal[1],
      normal[2],
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
  _normal: [number, number, number],
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
    bx - halfW,
    by - halfH,
    bz,
    bx + halfW,
    by - halfH,
    bz,
    bx + halfW,
    by + halfH,
    bz,
    bx - halfW,
    by + halfH,
    bz,
    // top face (z = bz + height)
    bx - halfW,
    by - halfH,
    bz + height,
    bx + halfW,
    by - halfH,
    bz + height,
    bx + halfW,
    by + halfH,
    bz + height,
    bx - halfW,
    by + halfH,
    bz + height,
  ];

  // Use the 8 vertices with per-face indexing. Since SimpleMeshLayer
  // doesn't do per-face normals well, approximate with vertex normals
  // pointing outward. Good enough for tiny chimney boxes.
  const indices = [
    // bottom
    0, 2, 1, 0, 3, 2,
    // top
    4, 5, 6, 4, 6, 7,
    // front (-Y)
    0, 1, 5, 0, 5, 4,
    // back (+Y)
    2, 3, 7, 2, 7, 6,
    // left (-X)
    0, 4, 7, 0, 7, 3,
    // right (+X)
    1, 2, 6, 1, 6, 5,
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

function matchDetections(detections: Detection[], buildings: ParsedBuilding[]): MatchedDetection[] {
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
 * For each roof triangle we keep the three vertex XYs (for barycentric
 * containment tests), the three Zs (for interpolating a landing height at
 * the exact detection point), the face normal, and a `slopeNormal` — the
 * cluster-canonical normal of the roof slope this triangle belongs to.
 *
 * The slope cluster exists so that coplanar-ish triangles (LOD2 meshes
 * frequently split one physical slope into several triangles whose normals
 * differ by tiny floating-point noise) all share a single orientation for
 * the panel that lands on them. Without this, two detections on the same
 * physical roof slope can render at visibly different tilts.
 */
type RoofFace = {
  cx: number;
  cy: number;
  cz: number;
  xy: [number, number, number, number, number, number];
  z: [number, number, number];
  normal: [number, number, number];
  slopeNormal: [number, number, number];
  area: number;
};

/** Area of a triangle given the 9-float vertex block. */
function triangleArea(roof: Float32Array, base: number): number {
  const e1x = roof[base + 3] - roof[base];
  const e1y = roof[base + 4] - roof[base + 1];
  const e1z = roof[base + 5] - roof[base + 2];
  const e2x = roof[base + 6] - roof[base];
  const e2y = roof[base + 7] - roof[base + 1];
  const e2z = roof[base + 8] - roof[base + 2];
  const cx = e1y * e2z - e1z * e2y;
  const cy = e1z * e2x - e1x * e2z;
  const cz = e1x * e2y - e1y * e2x;
  return 0.5 * Math.hypot(cx, cy, cz);
}

/**
 * Group triangles whose normals are within ~10° of each other into a single
 * "slope". Each group's canonical normal is the area-weighted mean of the
 * member normals (then renormalized). Returns an array parallel to `faces`
 * giving the group-canonical normal for each face.
 *
 * Greedy first-match grouping — not a proper clustering algorithm, but
 * good enough for typical LOD2 roofs (a few large coplanar groups).
 */
function computeSlopeNormals(
  normals: [number, number, number][],
  areas: number[],
): [number, number, number][] {
  const COS_THRESHOLD = Math.cos((10 * Math.PI) / 180);
  const groups: { mean: [number, number, number]; area: number }[] = [];
  const groupIdx = new Int32Array(normals.length);

  for (let i = 0; i < normals.length; i++) {
    const n = normals[i];
    let matched = -1;
    for (let g = 0; g < groups.length; g++) {
      const m = groups[g].mean;
      const dot = m[0] * n[0] + m[1] * n[1] + m[2] * n[2];
      if (dot > COS_THRESHOLD) {
        matched = g;
        break;
      }
    }
    if (matched >= 0) {
      const gr = groups[matched];
      const a = areas[i];
      const totalA = gr.area + a;
      gr.mean[0] = (gr.mean[0] * gr.area + n[0] * a) / totalA;
      gr.mean[1] = (gr.mean[1] * gr.area + n[1] * a) / totalA;
      gr.mean[2] = (gr.mean[2] * gr.area + n[2] * a) / totalA;
      const len = Math.hypot(gr.mean[0], gr.mean[1], gr.mean[2]) || 1;
      gr.mean[0] /= len;
      gr.mean[1] /= len;
      gr.mean[2] /= len;
      gr.area = totalA;
      groupIdx[i] = matched;
    } else {
      groups.push({ mean: [n[0], n[1], n[2]], area: areas[i] });
      groupIdx[i] = groups.length - 1;
    }
  }

  return normals.map((_, i) => {
    const m = groups[groupIdx[i]].mean;
    return [m[0], m[1], m[2]];
  });
}

function extractRoofFaces(b: ParsedBuilding): RoofFace[] {
  const roof = extractRoofPositions(b);
  const triCount = roof.length / 9;
  const normals: [number, number, number][] = [];
  const areas: number[] = [];
  for (let t = 0; t < triCount; t++) {
    const base = t * 9;
    normals.push(triangleNormal(roof, base));
    areas.push(triangleArea(roof, base));
  }
  const slopeNormals = computeSlopeNormals(normals, areas);

  const faces: RoofFace[] = [];
  for (let t = 0; t < triCount; t++) {
    const base = t * 9;
    faces.push({
      cx: (roof[base] + roof[base + 3] + roof[base + 6]) / 3,
      cy: (roof[base + 1] + roof[base + 4] + roof[base + 7]) / 3,
      cz: (roof[base + 2] + roof[base + 5] + roof[base + 8]) / 3,
      xy: [
        roof[base],
        roof[base + 1],
        roof[base + 3],
        roof[base + 4],
        roof[base + 6],
        roof[base + 7],
      ],
      z: [roof[base + 2], roof[base + 5], roof[base + 8]],
      normal: normals[t],
      slopeNormal: slopeNormals[t],
      area: areas[t],
    });
  }
  return faces;
}

/**
 * Find the roof triangle whose XY projection contains (x,y), and return the
 * interpolated elevation at that point. If none contains the point — the
 * detection bbox might straddle a gutter or the roof mesh is incomplete —
 * return null and let the caller pick a fallback.
 *
 * When multiple triangles contain the point (overlapping LOD2 roof parts),
 * we pick the highest one so detections land on the topmost surface.
 */
function findFaceContaining(
  faces: RoofFace[],
  x: number,
  y: number,
): { faceIdx: number; z: number } | null {
  let bestIdx = -1;
  let bestZ = -Infinity;
  for (let i = 0; i < faces.length; i++) {
    const [ax, ay, bx, by, cx, cy] = faces[i].xy;
    const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(denom) < 1e-9) continue;
    const u = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / denom;
    const v = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / denom;
    const w = 1 - u - v;
    if (u < -1e-4 || v < -1e-4 || w < -1e-4) continue;
    const z = u * faces[i].z[0] + v * faces[i].z[1] + w * faces[i].z[2];
    if (z > bestZ) {
      bestZ = z;
      bestIdx = i;
    }
  }
  return bestIdx < 0 ? null : { faceIdx: bestIdx, z: bestZ };
}

function findNearestFace(faces: RoofFace[], x: number, y: number): number {
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < faces.length; i++) {
    const dx = faces[i].cx - x;
    const dy = faces[i].cy - y;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function hasGeoBbox(
  d: Detection,
): d is Detection & { geo_xmin: number; geo_ymin: number; geo_xmax: number; geo_ymax: number } {
  return d.geo_xmin != null && d.geo_ymin != null && d.geo_xmax != null && d.geo_ymax != null;
}

/** Minimum rendered half-dimensions in meters so very tight bboxes stay visible. */
const MIN_HALF_W = 0.2;
const MIN_HALF_H = 0.15;

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

    // Meters-per-degree at THIS building's latitude (vs. the viewport origin
    // used for the merged frame). For small viewports the difference is tiny,
    // but using the building's latitude makes the geo→local conversion exact
    // for each detection's own bbox.
    const bLatRad = (b.lat * Math.PI) / 180;
    const bMperDegLat = mPerDegLat;
    const bMperDegLng = bMperDegLat * Math.cos(bLatRad);

    // Sort detections by score descending — used by the per-building limits
    // below (e.g. chimney cap) so the highest-confidence ones win.
    dets.sort((a, b) => b.score - a.score);

    // Limit chimneys to 2 per building (highest confidence first, already
    // sorted). Most buildings have only 1-2 physical chimneys; the SAT
    // model tends to over-detect them.
    const MAX_CHIMNEYS_PER_BUILDING = 2;
    let chimneyCount = 0;

    // Chimneys don't use the per-detection geo_* path: SAM-3's bbox around a
    // chimney is noisy (often spanning the chimney's shadow on the roof) and
    // the box is vertically extruded, so a bad bbox produces a wrong-sized
    // box at the wrong height. We keep the old nearest-central-face heuristic
    // with hardcoded chimney dimensions — visually identical to pre-geo_*.
    const usedChimneyFaces = new Set<number>();

    for (const det of dets) {
      if (det.label === "chimney" && chimneyCount >= MAX_CHIMNEYS_PER_BUILDING) continue;

      let localX: number;
      let localY: number;
      let halfW: number;
      let halfH: number;
      let face: RoofFace;

      if (det.label === "chimney") {
        // Old behavior: nearest unused central roof face, hardcoded 0.25m base.
        let bestIdx = -1;
        let bestDist = Infinity;
        for (let i = 0; i < faces.length; i++) {
          if (usedChimneyFaces.has(i)) continue;
          const d = faces[i].cx * faces[i].cx + faces[i].cy * faces[i].cy;
          if (d < bestDist) {
            bestDist = d;
            bestIdx = i;
          }
        }
        if (bestIdx < 0) bestIdx = 0;
        usedChimneyFaces.add(bestIdx);
        face = faces[bestIdx];
        localX = face.cx;
        localY = face.cy;
        halfW = 0.25;
        halfH = 0.25;
      } else if (hasGeoBbox(det)) {
        // Flat panels (roof windows, PV): use the per-detection geo bbox.
        // Position is the bbox centroid in the building's local meter frame,
        // size is derived from bbox dimensions, orientation is the slope's
        // canonical normal (not the individual triangle's) so coplanar-ish
        // triangles share a single tilt.
        const detLon = (det.geo_xmin + det.geo_xmax) / 2;
        const detLat = (det.geo_ymin + det.geo_ymax) / 2;
        localX = (detLon - b.lng) * bMperDegLng;
        localY = (detLat - b.lat) * bMperDegLat;
        halfW = Math.max(MIN_HALF_W, ((det.geo_xmax - det.geo_xmin) * bMperDegLng) / 2);
        halfH = Math.max(MIN_HALF_H, ((det.geo_ymax - det.geo_ymin) * bMperDegLat) / 2);

        const hit = findFaceContaining(faces, localX, localY);
        if (hit) {
          face = faces[hit.faceIdx];
          // Use the interpolated elevation at (localX, localY), not the
          // triangle centroid's — panels on sloped roofs otherwise sit off
          // the surface.
          face = { ...face, cz: hit.z };
        } else {
          // Off-mesh: snap to nearest face centroid so we don't render mid-air.
          face = faces[findNearestFace(faces, localX, localY)];
        }
      } else {
        // Flat panel with no geo bbox (legacy row): hardcoded defaults.
        face = faces[findNearestFace(faces, 0, 0)];
        localX = face.cx;
        localY = face.cy;
        if (det.label === "photovoltaic solar panel") {
          halfW = 0.8;
          halfH = 0.5;
        } else {
          halfW = 0.35;
          halfH = 0.25;
        }
      }

      const center: [number, number, number] = [localX + east, localY + north, face.cz];

      let mesh: MeshData;
      let vertCount: number;
      if (det.label === "chimney") {
        mesh = buildChimneyBox(center, face.normal, halfW, halfH, 0.6);
        vertCount = 8;
        chimneyCount++;
      } else {
        // Orient flat panels by the cluster-canonical slope normal so every
        // panel on the same roof slope lies parallel to its neighbors.
        mesh = buildRoofQuad(center, face.slopeNormal, halfW, halfH);
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
  opts?: { roofWindowMinScore?: number },
): SimpleMeshLayer<InstanceDatum>[] {
  if (detections.length === 0 || buildings.length === 0 || !origin) return [];

  const roofWindowMinScore = opts?.roofWindowMinScore ?? 0;
  const filtered =
    roofWindowMinScore > 0
      ? detections.filter((d) => d.label !== "roof window" || d.score >= roofWindowMinScore)
      : detections;

  const matched = matchDetections(filtered, buildings);
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
