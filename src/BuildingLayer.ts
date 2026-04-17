/**
 * deck.gl SimpleMeshLayer that renders full CityJSON 3D meshes — real roof
 * shapes, not extruded footprints.
 *
 * Strategy: merge every visible CityJSON into ONE BufferGeometry in local
 * meters (with each building's lng/lat offset baked into the vertex positions),
 * then draw it as a single instance of a SimpleMeshLayer anchored at a shared
 * origin via COORDINATE_SYSTEM.METER_OFFSETS.
 *
 * Perf contract:
 * - The layer id is stable ("argile-buildings") so deck.gl can diff it
 *   across renders rather than destroying + recreating on every pan.
 * - The origin is FROZEN by the caller (see useLayerOrigin in App.tsx) so
 *   small pans don't invalidate the merged mesh. Re-baking the origin is
 *   only required when we drift more than a few km or the set of buildings
 *   actually changes.
 * - The caller memoizes the merged mesh by the set of building ids, so
 *   identical building sets across renders produce the same mesh reference
 *   and deck.gl skips the GPU re-upload.
 */

import { COORDINATE_SYSTEM } from "@deck.gl/core";
import { SimpleMeshLayer } from "@deck.gl/mesh-layers";
import type { TriangleSoup } from "./mergeBuildings";
import { ROOF_COLORS, type RoofMaterial } from "./roofMaterials";

type InstanceDatum = { position: [number, number, number] };

/** The mesh prop shape accepted by deck.gl SimpleMeshLayer. */
export type DeckMesh = {
  attributes: {
    positions: { value: Float32Array; size: 3 };
    normals: { value: Float32Array; size: 3 };
  };
  indices: { value: Uint32Array; size: 1 };
};

export function toDeckMesh(soup: TriangleSoup): DeckMesh {
  return {
    attributes: {
      positions: { value: soup.positions, size: 3 },
      normals: { value: soup.normals, size: 3 },
    },
    indices: { value: soup.indices, size: 1 },
  };
}

export function createBuildingLayer(
  mesh: DeckMesh,
  origin: { lat: number; lng: number },
): SimpleMeshLayer<InstanceDatum> {
  // Single "instance" at the frozen origin — all per-building placement is
  // already baked into `mesh` via mergeBuildings().
  const data: InstanceDatum[] = [{ position: [0, 0, 0] }];

  return new SimpleMeshLayer<InstanceDatum>({
    id: "argile-buildings",
    data,
    mesh,
    coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
    coordinateOrigin: [origin.lng, origin.lat, 0],
    getPosition: (d) => d.position,
    getColor: [235, 205, 175, 255],
    material: {
      ambient: 0.35,
      diffuse: 0.65,
      shininess: 24,
      specularColor: [60, 64, 70],
    },
    pickable: false,
    // The mesh reference is stable whenever the building set hasn't
    // changed (see useLayerMesh in App.tsx), so deck.gl's diffing avoids
    // GPU re-uploads on pans that don't add/remove buildings.
    updateTriggers: {
      mesh: mesh,
    },
  });
}

/**
 * One SimpleMeshLayer per roof material, all anchored at the same origin.
 * Split into layers rather than a single mesh with per-vertex colors because
 * SimpleMeshLayer's color channel is per-instance — this also leaves room
 * to swap a flat color for a material-specific texture layer-by-layer.
 *
 * Layer ids are stable (derived from the material name), so pans that keep
 * the same set of materials reuse the GPU state.
 */
export function createRoofMaterialLayers(
  roofsByMaterial: Map<RoofMaterial, DeckMesh>,
  origin: { lat: number; lng: number },
): SimpleMeshLayer<InstanceDatum>[] {
  const data: InstanceDatum[] = [{ position: [0, 0, 0] }];
  const layers: SimpleMeshLayer<InstanceDatum>[] = [];
  for (const [material, mesh] of roofsByMaterial) {
    const [r, g, b] = ROOF_COLORS[material];
    layers.push(
      new SimpleMeshLayer<InstanceDatum>({
        id: `argile-roof-${material}`,
        data,
        mesh,
        coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
        coordinateOrigin: [origin.lng, origin.lat, 0],
        getPosition: (d) => d.position,
        getColor: [r, g, b, 255],
        material: {
          ambient: 0.4,
          diffuse: 0.7,
          shininess: 20,
          specularColor: [40, 40, 40],
        },
        pickable: false,
        updateTriggers: { mesh },
      }),
    );
  }
  return layers;
}
