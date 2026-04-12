/// <reference lib="webworker" />
/**
 * Web Worker that parses CityJSON buildings off the main thread.
 *
 * Protocol:
 *   main → worker: { id, building }
 *   worker → main: { id, result: { ...parsed fields } | null }
 *
 * The TypedArray buffers are transferred (zero main-thread memcpy).
 */

import { parseBuilding } from "../cityjsonMesh";
import type { CityJsonBuilding } from "../types";

type InMessage = {
  id: string;
  building: CityJsonBuilding;
};

type OutResult = {
  lat: number;
  lng: number;
  height: number;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  surfaceTypes: Int32Array;
  roofCentroid: [number, number, number] | null;
  roofNormal: [number, number, number] | null;
};

type OutMessage = { id: string; result: OutResult | null };

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (e: MessageEvent<InMessage>) => {
  const { id, building } = e.data;
  const parsed = parseBuilding(building);
  if (!parsed) {
    scope.postMessage({ id, result: null } satisfies OutMessage);
    return;
  }

  const msg: OutMessage = {
    id,
    result: {
      lat: parsed.lat,
      lng: parsed.lng,
      height: parsed.height,
      positions: parsed.soup.positions,
      normals: parsed.soup.normals,
      indices: parsed.soup.indices,
      surfaceTypes: parsed.soup.surfaceTypes,
      roofCentroid: parsed.roofCentroid,
      roofNormal: parsed.roofNormal,
    },
  };

  scope.postMessage(msg, [
    parsed.soup.positions.buffer,
    parsed.soup.normals.buffer,
    parsed.soup.indices.buffer,
    parsed.soup.surfaceTypes.buffer,
  ]);
};
