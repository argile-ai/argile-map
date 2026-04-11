import { MapboxOverlay } from "@deck.gl/mapbox";
import { useCallback, useMemo, useRef, useState } from "react";
import { Map as MapGL, useControl } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";

import { createBuildingLayer } from "./BuildingLayer";
import { parseBuilding, type ParsedBuilding } from "./cityjsonMesh";
import { config, INITIAL_VIEW } from "./config";
import type { CityJsonBuilding } from "./types";
import { useViewportBuildings, type Bounds } from "./useViewportBuildings";

/**
 * deck.gl overlay mounted inside a react-map-gl MapLibre map.
 * Based on the canonical react-map-gl + deck.gl interop pattern.
 */
function DeckGLOverlay({
  layers,
}: {
  layers: ReturnType<typeof createBuildingLayer>[];
}): null {
  // biome-ignore lint/suspicious/noExplicitAny: useControl signature isn't narrowed.
  const overlay = useControl<any>(() => new MapboxOverlay({ interleaved: true, layers }));
  overlay.setProps({ layers });
  return null;
}

/**
 * Cache CityJSON → ParsedBuilding so we don't re-parse the same building
 * every render. The parse is expensive (triangulation + normal computation).
 */
function useParsedBuildings(buildings: CityJsonBuilding[]): ParsedBuilding[] {
  const cache = useRef(new Map<string, ParsedBuilding>());
  return useMemo(() => {
    const out: ParsedBuilding[] = [];
    const seen = new Set<string>();
    for (const b of buildings) {
      seen.add(b.geopf_id);
      let parsed = cache.current.get(b.geopf_id);
      if (!parsed) {
        const p = parseBuilding(b);
        if (!p) continue;
        parsed = p;
        cache.current.set(b.geopf_id, parsed);
      }
      out.push(parsed);
    }
    // Evict buildings no longer present to keep the cache bounded.
    for (const key of cache.current.keys()) {
      if (!seen.has(key)) cache.current.delete(key);
    }
    return out;
  }, [buildings]);
}

export function App() {
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null);

  const buildings = useViewportBuildings(bounds);
  const parsed = useParsedBuildings(buildings);

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
    setCenter({ lat: c.lat, lng: c.lng });
  }, []);

  const layers = useMemo(() => {
    const layer = createBuildingLayer(parsed, center);
    return layer ? [layer] : [];
  }, [parsed, center]);

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
        }}
      >
        <div>
          <strong>Argile Map</strong>
        </div>
        <div>
          {parsed.length} / {buildings.length} buildings rendered
        </div>
      </div>
    </div>
  );
}
