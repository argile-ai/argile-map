/// <reference lib="webworker" />
/**
 * Web Worker that parses CityJSON buildings off the main thread.
 *
 * Protocol:
 *   main → worker: { building: CityJsonBuilding }      (via postMessage)
 *   worker → main: { id, result: { lat, lng, height, positions, normals, indices } | null }
 *
 * The response arrays are transferred (not cloned) via the Transferable API
 * so there's zero main-thread memcpy on the hot path. If parsing fails we
 * return `result: null` and the main thread skips the building silently.
 *
 * We import `parseBuilding` from cityjsonMesh.ts here — that file imports
 * cityjson-threejs-loader and three.js, which is fine in a Worker because
 * Vite transforms the worker bundle with its normal resolver (unlike Vitest
 * which is stricter).
 */

import { parseBuilding } from "../cityjsonMesh";
import type { CityJsonBuilding } from "../types";

type InMessage = {
  id: string;
  building: CityJsonBuilding;
};

type OutMessage =
  | {
      id: string;
      result: {
        lat: number;
        lng: number;
        height: number;
        positions: Float32Array;
        normals: Float32Array;
        indices: Uint32Array;
      };
    }
  | { id: string; result: null };

// eslint-disable-next-line no-restricted-globals
const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (e: MessageEvent<InMessage>) => {
  const { id, building } = e.data;
  const parsed = parseBuilding(building);
  if (!parsed) {
    const msg: OutMessage = { id, result: null };
    scope.postMessage(msg);
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
    },
  };

  scope.postMessage(msg, [
    parsed.soup.positions.buffer,
    parsed.soup.normals.buffer,
    parsed.soup.indices.buffer,
  ]);
};
