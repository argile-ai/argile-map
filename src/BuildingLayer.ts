/**
 * deck.gl SimpleMeshLayer that renders full CityJSON 3D meshes — real roof
 * shapes, not extruded footprints.
 *
 * Strategy: merge every visible CityJSON into ONE BufferGeometry in local
 * meters (with each building's lng/lat offset baked into the vertex positions),
 * then draw it as a single instance of a SimpleMeshLayer anchored at a shared
 * origin via COORDINATE_SYSTEM.METER_OFFSETS.
 *
 * Result: one draw call for the entire visible city.
 */

import { COORDINATE_SYSTEM } from "@deck.gl/core";
import { SimpleMeshLayer } from "@deck.gl/mesh-layers";
import { mergeBuildings, type ParsedBuilding } from "./cityjsonMesh";

type InstanceDatum = { position: [number, number, number] };

export function createBuildingLayer(
  buildings: ParsedBuilding[],
  origin: { lat: number; lng: number } | null,
): SimpleMeshLayer<InstanceDatum> | null {
  if (!origin || buildings.length === 0) return null;

  const soup = mergeBuildings(buildings, origin);

  // Single "instance" positioned at the origin (0,0 in local meters). All the
  // per-building placement is already baked into the merged mesh positions.
  const data: InstanceDatum[] = [{ position: [0, 0, 0] }];

  return new SimpleMeshLayer<InstanceDatum>({
    id: `argile-buildings-${buildings.length}-${buildings[0]?.geopf_id ?? "x"}`,
    data,
    mesh: {
      attributes: {
        positions: { value: soup.positions, size: 3 },
        normals: { value: soup.normals, size: 3 },
      },
      indices: { value: soup.indices, size: 1 },
    },
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
  });
}
