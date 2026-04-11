/**
 * Reactive snapshot of the in-flight tile fetches. Used by the HUD to show
 * "Loading N tiles..." and surface errors.
 */

import { useSyncExternalStore } from "react";
import {
  getTileStatusSnapshot,
  subscribeTileStatus,
  type TileStatus,
} from "./collections";
import type { TileId } from "./tiles";

export type TileStatusSummary = {
  pending: number;
  ready: number;
  error: number;
  lastError: TileId | null;
};

let lastSnapshotKey = "";
let lastSummary: TileStatusSummary = { pending: 0, ready: 0, error: 0, lastError: null };

function computeSummary(): TileStatusSummary {
  const map = getTileStatusSnapshot() as ReadonlyMap<TileId, TileStatus>;
  // Build a key so React's useSyncExternalStore sees a stable reference
  // when the underlying counts haven't changed.
  let pending = 0;
  let ready = 0;
  let error = 0;
  let lastError: TileId | null = null;
  for (const [id, status] of map) {
    if (status === "pending") pending++;
    else if (status === "ready") ready++;
    else {
      error++;
      lastError = id;
    }
  }
  const key = `${pending}|${ready}|${error}|${lastError ?? ""}`;
  if (key !== lastSnapshotKey) {
    lastSnapshotKey = key;
    lastSummary = { pending, ready, error, lastError };
  }
  return lastSummary;
}

export function useTileStatus(): TileStatusSummary {
  return useSyncExternalStore(subscribeTileStatus, computeSummary, computeSummary);
}
