/**
 * Reactive snapshot of the current viewport fetch state. Consumed by the
 * HUD to show a loading indicator or error banner.
 */

import { useSyncExternalStore } from "react";
import {
  getViewportStatus,
  subscribeViewportStatus,
  type ViewportStatus,
} from "./collections";

export type ViewportStatusSummary = {
  status: ViewportStatus;
  error: string | null;
};

let lastSnapshotKey = "";
let lastSummary: ViewportStatusSummary = { status: "idle", error: null };

function computeSummary(): ViewportStatusSummary {
  const { status, error } = getViewportStatus();
  const key = `${status}|${error ?? ""}`;
  if (key !== lastSnapshotKey) {
    lastSnapshotKey = key;
    lastSummary = { status, error };
  }
  return lastSummary;
}

export function useViewportStatus(): ViewportStatusSummary {
  return useSyncExternalStore(subscribeViewportStatus, computeSummary, computeSummary);
}
