import { MapboxOverlay } from "@deck.gl/mapbox";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Map as MapGL, useControl } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";

import { createBuildingLayer, toDeckMesh } from "./BuildingLayer";
import type { ParsedBuilding } from "./cityjsonMesh";
import { config, INITIAL_VIEW } from "./config";
import { createDetectionLayer } from "./DetectionLayer";
import { mergeBuildings } from "./mergeBuildings";
import type { CityJsonBuilding } from "./types";
import { useTileStatus } from "./useTileStatus";
import { useViewportBuildings, type Bounds } from "./useViewportBuildings";
import { useViewportDetections } from "./useViewportDetections";
import { parseBuildingAsync } from "./workers/parsePool";

/**
 * deck.gl overlay mounted inside a react-map-gl MapLibre map.
 * Based on the canonical react-map-gl + deck.gl interop pattern.
 */
// biome-ignore lint/suspicious/noExplicitAny: deck.gl Layer generic bleed.
function DeckGLOverlay({ layers }: { layers: any[] }): null {
  // biome-ignore lint/suspicious/noExplicitAny: useControl signature isn't narrowed.
  const overlay = useControl<any>(() => new MapboxOverlay({ interleaved: true, layers }));
  overlay.setProps({ layers });
  return null;
}

/**
 * Parse CityJSON in a Web Worker pool so the main thread isn't blocked
 * while panning over dense neighborhoods. The hook keeps a persistent
 * cache keyed by geopf_id and returns only the buildings that have
 * finished parsing — deck.gl re-renders smoothly as more come in.
 *
 * This is an incremental update model: we never re-parse a building we
 * already have, and evicted buildings are dropped from the cache on the
 * next tick so the memory stays bounded.
 */
function useParsedBuildings(buildings: CityJsonBuilding[]): ParsedBuilding[] {
  const cacheRef = useRef(new Map<string, ParsedBuilding>());
  // A bump counter drives re-renders whenever a worker response lands.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const cache = cacheRef.current;
    const currentKeys = new Set<string>();
    const toParse: CityJsonBuilding[] = [];
    for (const b of buildings) {
      currentKeys.add(b.geopf_id);
      if (!cache.has(b.geopf_id)) toParse.push(b);
    }
    // Evict buildings no longer visible. We bump the version even if no new
    // buildings arrived, so the component re-renders and the layer drops
    // them from the merged mesh.
    let changed = false;
    for (const key of [...cache.keys()]) {
      if (!currentKeys.has(key)) {
        cache.delete(key);
        changed = true;
      }
    }
    if (changed) setVersion((v) => v + 1);

    let cancelled = false;
    for (const b of toParse) {
      parseBuildingAsync(b).then((parsed) => {
        if (cancelled || !parsed) return;
        // Only write it if the building is still in the viewport.
        if (!currentKeys.has(parsed.geopf_id)) return;
        cache.set(parsed.geopf_id, parsed);
        setVersion((v) => v + 1);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [buildings]);

  return useMemo(() => {
    const cache = cacheRef.current;
    const out: ParsedBuilding[] = [];
    for (const b of buildings) {
      const parsed = cache.get(b.geopf_id);
      if (parsed) out.push(parsed);
    }
    return out;
    // `version` captures cache mutations; `buildings` captures viewport changes.
  }, [buildings, version]);
}

/**
 * Pick (and freeze) a long-lived origin for the mesh local-meter frame. We
 * only move the origin when the camera has drifted > MAX_DRIFT_KM from it,
 * so small pans don't rebuild the merged mesh (which would trigger a GPU
 * re-upload). The threshold is well below the Float32 precision horizon for
 * vertex coords.
 */
const MAX_DRIFT_KM = 3;

function useFrozenOrigin(
  camera: { lat: number; lng: number } | null,
): { lat: number; lng: number } | null {
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    if (!camera) return;
    if (!origin) {
      setOrigin(camera);
      return;
    }
    // Haversine-free approximation: convert deltas to kilometers at the
    // origin's latitude.
    const dLat = (camera.lat - origin.lat) * 111;
    const dLng =
      (camera.lng - origin.lng) * 111 * Math.cos((origin.lat * Math.PI) / 180);
    if (Math.hypot(dLat, dLng) > MAX_DRIFT_KM) {
      setOrigin(camera);
    }
  }, [camera, origin]);
  return origin;
}

/**
 * Stable hash of the set of building ids currently rendered. The merged
 * mesh is memoized on this hash so panning without adding/removing any
 * building yields the SAME mesh object reference → deck.gl's updateTriggers
 * sees no change → no GPU re-upload.
 */
function buildingsHash(buildings: ParsedBuilding[]): string {
  // Sort + join is fine — N is at most a few thousand per viewport.
  return buildings
    .map((b) => b.geopf_id)
    .sort()
    .join("|");
}

export function App() {
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [camera, setCamera] = useState<{ lat: number; lng: number } | null>(null);

  const buildings = useViewportBuildings(bounds);
  const parsed = useParsedBuildings(buildings);
  const origin = useFrozenOrigin(camera);
  const status = useTileStatus();
  const detections = useViewportDetections(bounds);

  const onMove = useCallback((e: { target: unknown }) => {
    // biome-ignore lint/suspicious/noExplicitAny: react-map-gl move event target type.
    const map = e.target as any;
    const b = map.getBounds();
    const c = map.getCenter();
    setBounds({
      minLat: b.getSouth(),
      maxLat: b.getNorth(),
      minLng: b.getWest(),
      maxLng: b.getEast(),
    });
    setCamera({ lat: c.lat, lng: c.lng });
  }, []);

  // Merge the parsed buildings into a single TriangleSoup anchored at the
  // frozen origin. Memoized by (building set hash, origin) — pans that don't
  // change either return the exact same mesh reference so deck.gl skips the
  // GPU re-upload.
  const hash = useMemo(() => buildingsHash(parsed), [parsed]);
  const mesh = useMemo(() => {
    if (!origin || parsed.length === 0) return null;
    return toDeckMesh(mergeBuildings(parsed, origin));
    // biome-ignore lint/correctness/useExhaustiveDependencies: hash drives `parsed`
  }, [hash, origin]);

  const layers = useMemo(() => {
    // biome-ignore lint/suspicious/noExplicitAny: deck.gl Layer generic bleed.
    const out: any[] = [];
    if (mesh && origin) out.push(createBuildingLayer(mesh, origin));
    const detLayer = createDetectionLayer(detections);
    if (detLayer) out.push(detLayer);
    return out;
  }, [mesh, origin, detections]);

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <MapGL
        initialViewState={INITIAL_VIEW}
        mapStyle={config.mapStyle}
        onMove={onMove}
        onLoad={onMove}
        maxPitch={75}
        attributionControl={{ compact: true }}
      >
        <DeckGLOverlay layers={layers} />
      </MapGL>
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          padding: "8px 12px",
          background: "rgba(20,20,30,0.85)",
          color: "white",
          borderRadius: 8,
          fontFamily: "system-ui, sans-serif",
          fontSize: 13,
          pointerEvents: "none",
          minWidth: 180,
        }}
      >
        <div>
          <strong>Argile Map</strong>
        </div>
        <div>
          {parsed.length} / {buildings.length} buildings rendered
        </div>
        <div>{detections.length} detections in view</div>
        <div style={{ opacity: 0.75, marginTop: 2 }}>
          {status.pending > 0
            ? `Loading ${status.pending} tile${status.pending > 1 ? "s" : ""}…`
            : `${status.ready} tile${status.ready === 1 ? "" : "s"} loaded`}
        </div>
        {status.error > 0 && (
          <div style={{ color: "#ff7979", marginTop: 4 }}>
            {status.error} tile{status.error > 1 ? "s" : ""} failed
          </div>
        )}
      </div>
    </div>
  );
}
