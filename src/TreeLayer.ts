/**
 * 3D tree visualization using SimpleMeshLayer with cone-shaped crowns.
 *
 * Each tree = brown cylinder trunk + green cone crown. Conifers get a
 * taller narrower cone; deciduous get a wider flatter one.
 *
 * We build ONE unit cone mesh and ONE unit cylinder mesh, then instance
 * them per tree with per-instance position, scale, and color.
 */

import { COORDINATE_SYSTEM } from "@deck.gl/core";
import { SimpleMeshLayer } from "@deck.gl/mesh-layers";

export type TreeFeature = {
  position: [number, number];
  height_m: number;
  crown_diameter_m: number;
  crown_area_m2: number;
  is_conifer: boolean;
  n_points: number;
};

// --- Mesh generation ---

type MeshGeom = {
  attributes: {
    positions: { value: Float32Array; size: 3 };
    normals: { value: Float32Array; size: 3 };
  };
  indices: { value: Uint32Array; size: 1 };
};

/** Unit cone: base at z=0, apex at z=1, base radius=1. */
function buildConeMesh(segments: number = 8): MeshGeom {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  // Apex vertex
  positions.push(0, 0, 1);
  normals.push(0, 0, 1);

  // Base ring
  const slope = Math.atan2(1, 1); // 45° slope for normal
  const nz = Math.cos(slope);
  const nr = Math.sin(slope);
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    positions.push(Math.cos(a), Math.sin(a), 0);
    normals.push(Math.cos(a) * nr, Math.sin(a) * nr, nz);
  }

  // Base center
  positions.push(0, 0, 0);
  normals.push(0, 0, -1);

  // Side triangles (apex=0, ring=1..segments)
  for (let i = 0; i < segments; i++) {
    indices.push(0, 1 + i, 1 + ((i + 1) % segments));
  }
  // Base triangles (center = segments+1)
  const baseCenter = segments + 1;
  for (let i = 0; i < segments; i++) {
    indices.push(baseCenter, 1 + ((i + 1) % segments), 1 + i);
  }

  return {
    attributes: {
      positions: { value: new Float32Array(positions), size: 3 },
      normals: { value: new Float32Array(normals), size: 3 },
    },
    indices: { value: new Uint32Array(indices), size: 1 },
  };
}

/** Unit cylinder: base at z=0, top at z=1, radius=1. */
function buildCylinderMesh(segments: number = 6): MeshGeom {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  // Bottom ring + top ring
  for (let ring = 0; ring < 2; ring++) {
    const z = ring;
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      positions.push(Math.cos(a), Math.sin(a), z);
      normals.push(Math.cos(a), Math.sin(a), 0);
    }
  }
  // Side quads
  for (let i = 0; i < segments; i++) {
    const b0 = i, b1 = (i + 1) % segments;
    const t0 = segments + i, t1 = segments + (i + 1) % segments;
    indices.push(b0, b1, t1, b0, t1, t0);
  }
  // Caps
  const bc = positions.length / 3;
  positions.push(0, 0, 0); normals.push(0, 0, -1);
  const tc = positions.length / 3;
  positions.push(0, 0, 1); normals.push(0, 0, 1);
  for (let i = 0; i < segments; i++) {
    indices.push(bc, (i + 1) % segments, i);
    indices.push(tc, segments + i, segments + (i + 1) % segments);
  }

  return {
    attributes: {
      positions: { value: new Float32Array(positions), size: 3 },
      normals: { value: new Float32Array(normals), size: 3 },
    },
    indices: { value: new Uint32Array(indices), size: 1 },
  };
}

// --- Cached meshes ---
let _cone: MeshGeom | null = null;
let _cylinder: MeshGeom | null = null;
function coneMesh(): MeshGeom { return _cone ?? (_cone = buildConeMesh()); }
function cylinderMesh(): MeshGeom { return _cylinder ?? (_cylinder = buildCylinderMesh()); }

// --- Colors ---

function crownColor(h: number, conifer: boolean): [number, number, number] {
  if (conifer) {
    const t = Math.min(1, (h - 3) / 20);
    return [10 + t * 30, 80 + t * 50, 20];
  }
  const t = Math.min(1, (h - 3) / 20);
  return [40 + t * 50, 130 + t * 90, 25 + t * 25];
}

// --- Layer creation ---

type TreeInstance = {
  position: [number, number];
  color: [number, number, number];
  scale: [number, number, number]; // [radiusX, radiusY, height]
  translation: [number, number, number];
};

export function createTreeLayers(
  trees: TreeFeature[],
  // biome-ignore lint/suspicious/noExplicitAny: SimpleMeshLayer generics
): any[] {
  if (trees.length === 0) return [];

  // Crown instances: cone scaled by [crown_radius, crown_radius, crown_height]
  // positioned at ground, elevated by trunk height via translation
  const crownData: TreeInstance[] = trees.map((t) => {
    const crownH = t.height_m * (t.is_conifer ? 0.7 : 0.5);
    const r = Math.max(0.5, t.crown_diameter_m / 2);
    return {
      position: t.position,
      color: crownColor(t.height_m, t.is_conifer),
      scale: [r, r, crownH],
      translation: [0, 0, t.height_m - crownH], // elevate cone base
    };
  });

  // Trunk instances: thin cylinder
  const trunkData: TreeInstance[] = trees.map((t) => {
    const trunkH = t.height_m * (t.is_conifer ? 0.3 : 0.5);
    return {
      position: t.position,
      color: [120, 80, 40],
      scale: [0.12, 0.12, trunkH],
      translation: [0, 0, 0],
    };
  });

  const crownLayer = new SimpleMeshLayer<TreeInstance>({
    id: "argile-tree-crowns",
    data: crownData,
    mesh: coneMesh(),
    getPosition: (d) => d.position,
    getColor: (d) => d.color,
    getScale: (d) => d.scale,
    getTranslation: (d) => d.translation,
    material: { ambient: 0.4, diffuse: 0.65, shininess: 8, specularColor: [40, 60, 30] },
    pickable: true,
  });

  const trunkLayer = new SimpleMeshLayer<TreeInstance>({
    id: "argile-tree-trunks",
    data: trunkData,
    mesh: cylinderMesh(),
    getPosition: (d) => d.position,
    getColor: (d) => d.color,
    getScale: (d) => d.scale,
    getTranslation: (d) => d.translation,
    material: { ambient: 0.3, diffuse: 0.7 },
    pickable: false,
  });

  return [trunkLayer, crownLayer];
}
