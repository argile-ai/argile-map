import { MapboxOverlay } from "@deck.gl/mapbox";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Map as MapGL, useControl, type MapRef } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";

import { createBuildingLayer, toDeckMesh } from "./BuildingLayer";
import type { ParsedBuilding } from "./cityjsonMesh";
import { config, INITIAL_VIEW } from "./config";
import { createDetectionLayer } from "./DetectionLayer";
import { mergeBuildings } from "./mergeBuildings";
import type { CityJsonBuilding } from "./types";
import { useViewportBuildings, type Bounds } from "./useViewportBuildings";
import { useViewportDetections } from "./useViewportDetections";
import { useViewportStatus } from "./useViewportStatus";
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

/**
 * Below this zoom the viewport spans enough ground that our ~400 m tile
 * grid would spawn hundreds of requests on every pan. Building data is
 * only meaningful zoomed in anyway — the map style already has its own
 * 2D building footprints for the overview.
 */
const MIN_ZOOM_FOR_BUILDINGS = 15;

export function App() {
  const mapRef = useRef<MapRef>(null);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [camera, setCamera] = useState<{ lat: number; lng: number } | null>(null);
  const [zoom, setZoom] = useState<number>(INITIAL_VIEW.zoom);

  // Only feed bounds to the data layer once we're zoomed in enough AND
  // the map has settled. Below the threshold we show nothing rather than
  // hammering the backend with dozens of tile fetches.
  const activeBounds = zoom >= MIN_ZOOM_FOR_BUILDINGS ? bounds : null;

  const buildings = useViewportBuildings(activeBounds);
  const parsed = useParsedBuildings(buildings);
  const origin = useFrozenOrigin(camera);
  const status = useViewportStatus();
  const detections = useViewportDetections(activeBounds);

  /**
   * `onMoveEnd` fires once per drag (when the user releases) instead of
   * the 60 Hz `onMove`. This is critical for the proxy/load flow: every
   * bounds update triggers tile resolution + fetches, and we don't want
   * that to run while the camera is still animating.
   */
  const onMoveEnd = useCallback((e: { target: unknown }) => {
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
    setZoom(map.getZoom());
  }, []);

  // Hide the basemap's shoe-box fill-extrusion building layer when we have
  // real CityJSON meshes. Show it again when we zoom out or have no buildings.
  const hasCityJsonBuildings = parsed.length > 0;
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const toggle = () => {
      const style = map.getStyle();
      if (!style?.layers) return;
      for (const layer of style.layers) {
        // Hide shoe-box fill-extrusions when we have real CityJSON meshes.
        if (layer.type === "fill-extrusion" && /building/i.test(layer.id)) {
          map.setLayoutProperty(
            layer.id,
            "visibility",
            hasCityJsonBuildings ? "none" : "visible",
          );
        }
        // Hide POI / building name labels (e.g. "Hôtel de Ville") but keep
        // street names (road_*), place names (place_*), and house numbers.
        if (
          layer.type === "symbol" &&
          /^(poi|building)/i.test(layer.id)
        ) {
          map.setLayoutProperty(layer.id, "visibility", "none");
        }
      }
    };
    // The style might not be loaded yet on first mount.
    if (map.isStyleLoaded()) toggle();
    else map.once("styledata", toggle);
  }, [hasCityJsonBuildings]);

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
        ref={mapRef}
        initialViewState={INITIAL_VIEW}
        mapStyle={config.mapStyle}
        onMoveEnd={onMoveEnd}
        onLoad={onMoveEnd}
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
        {zoom < MIN_ZOOM_FOR_BUILDINGS ? (
          <div style={{ opacity: 0.75 }}>
            Zoom in to load 3D buildings (z≥{MIN_ZOOM_FOR_BUILDINGS})
          </div>
        ) : (
          <>
            <div>
              {parsed.length} / {buildings.length} buildings rendered
            </div>
            <div>{detections.length} detections in view</div>
            <div style={{ opacity: 0.75, marginTop: 2 }}>
              {status.status === "loading"
                ? "Loading viewport…"
                : status.status === "ready"
                  ? "Loaded"
                  : status.status === "error"
                    ? "Failed"
                    : "Idle"}
            </div>
          </>
        )}
        {status.error && (
          <div style={{ color: "#ff7979", marginTop: 4 }}>{status.error}</div>
        )}
      </div>
    </div>
  );
}
