/**
 * Round-robin pool of CityJSON parser Workers. Main-thread code calls
 * `parseBuildingAsync(building)` and gets a ParsedBuilding back when the
 * worker responds. Pending requests are tracked by a monotonic counter so
 * we can match responses to callers even when multiple are in flight.
 */

import type { ParsedBuilding } from "../mergeBuildings";
import type { CityJsonBuilding } from "../types";

const POOL_SIZE =
  typeof navigator !== "undefined" && navigator.hardwareConcurrency
    ? Math.min(4, Math.max(1, navigator.hardwareConcurrency - 1))
    : 2;

type Pending = {
  resolve: (p: ParsedBuilding | null) => void;
};

let workers: Worker[] | null = null;
let nextWorker = 0;
let nextId = 0;
const pending = new Map<string, Pending>();

function ensureWorkers(): Worker[] {
  if (workers) return workers;
  workers = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    const w = new Worker(new URL("./parse.worker.ts", import.meta.url), {
      type: "module",
      name: `argile-parse-${i}`,
    });
    w.onmessage = (e) => {
      const { id, result } = e.data as {
        id: string;
        result: {
          lat: number;
          lng: number;
          lambert93Center: [number, number] | null;
          height: number;
          positions: Float32Array;
          normals: Float32Array;
          indices: Uint32Array;
          surfaceTypes: Int32Array;
          roofCentroid: [number, number, number] | null;
          roofNormal: [number, number, number] | null;
        } | null;
      };
      const cb = pending.get(id);
      if (!cb) return;
      pending.delete(id);
      if (!result) {
        cb.resolve(null);
        return;
      }
      cb.resolve({
        geopf_id: id.split("|", 2)[1] ?? "",
        lat: result.lat,
        lng: result.lng,
        lambert93Center: result.lambert93Center,
        height: result.height,
        soup: {
          positions: result.positions,
          normals: result.normals,
          indices: result.indices,
          surfaceTypes: result.surfaceTypes,
        },
        roofCentroid: result.roofCentroid,
        roofNormal: result.roofNormal,
      });
    };
    w.onerror = (err) => {
      console.error("parse.worker error", err);
    };
    workers.push(w);
  }
  return workers;
}

export function parseBuildingAsync(building: CityJsonBuilding): Promise<ParsedBuilding | null> {
  const pool = ensureWorkers();
  const worker = pool[nextWorker % pool.length];
  nextWorker++;
  // Encode the building key into the id so onmessage can reconstruct it.
  const id = `${nextId++}|${building.geopf_id}`;
  return new Promise((resolve) => {
    pending.set(id, { resolve });
    worker.postMessage({ id, building });
  });
}

/** Test-only: tear the pool down so hot-module-reload doesn't leak workers. */
export function __resetParsePool(): void {
  if (workers) {
    for (const w of workers) w.terminate();
    workers = null;
  }
  pending.clear();
  nextId = 0;
  nextWorker = 0;
}
