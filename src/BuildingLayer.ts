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
