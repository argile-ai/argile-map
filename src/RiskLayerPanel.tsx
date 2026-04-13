/**
 * Toggleable panel for Géorisques WMS risk overlay layers.
 * Radio buttons select one layer at a time. When active, the official
 * WMS legend image is displayed below the list.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { RISK_LAYERS, legendUrl, wmsUrl, type RiskLayerDef } from "./riskLayers";

type Props = {
  mapRef: React.RefObject<MapRef | null>;
};

function ensureWmsLayer(map: maplibregl.Map, def: RiskLayerDef): void {
  if (map.getSource(def.id)) return;
  map.addSource(def.id, {
    type: "raster",
    tiles: [wmsUrl(def.wmsLayer)],
    tileSize: 256,
  });
  map.addLayer({
    id: def.id,
    type: "raster",
    source: def.id,
    paint: { "raster-opacity": 0.6 },
  });
}

function removeWmsLayer(map: maplibregl.Map, id: string): void {
  if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(id)) map.removeSource(id);
}

export function RiskLayerPanel({ mapRef }: Props) {
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const addedRef = useRef(new Set<string>());

  const toggle = useCallback((id: string) => {
    setActiveId((prev) => (prev === id ? null : id));
  }, []);

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !map.isStyleLoaded()) return;
    for (const def of RISK_LAYERS) {
      if (def.id === activeId) {
        ensureWmsLayer(map, def);
        addedRef.current.add(def.id);
      } else {
        removeWmsLayer(map, def.id);
        addedRef.current.delete(def.id);
      }
    }
  }, [activeId, mapRef]);

  useEffect(() => {
    return () => {
      const map = mapRef.current?.getMap();
      if (!map) return;
      for (const id of addedRef.current) removeWmsLayer(map, id);
    };
  }, [mapRef]);

  const activeDef = RISK_LAYERS.find((l) => l.id === activeId);

  return (
    <div style={styles.wrapper}>
      <button type="button" style={styles.toggle} onClick={() => setOpen((o) => !o)}>
        <span style={{ fontSize: 16 }}>&#x1f5fa;</span>{" "}
        <span style={{ fontSize: 13 }}>Couches risques</span>
        <span style={{ marginLeft: "auto", fontSize: 10 }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={styles.panel}>
          {RISK_LAYERS.map((l) => (
            <label key={l.id} style={styles.row}>
              <input
                type="radio"
                name="risk-layer"
                checked={activeId === l.id}
                onChange={() => toggle(l.id)}
                style={{ marginRight: 8 }}
              />
              <span style={{ fontSize: 12 }}>{l.label}</span>
            </label>
          ))}
          {activeDef && (
            <div style={styles.legend}>
              <div style={styles.legendTitle}>Légende — {activeDef.label}</div>
              <img
                src={legendUrl(activeDef.wmsLayer)}
                alt={`Légende ${activeDef.label}`}
                style={styles.legendImg}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    position: "absolute",
    top: 12,
    left: 12,
    zIndex: 10,
    fontFamily: "'Lexend', system-ui, sans-serif",
    maxWidth: 280,
  },
  toggle: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    width: "100%",
    padding: "8px 12px",
    background: "rgba(20,20,30,0.85)",
    color: "white",
    border: "none",
    borderRadius: 10,
    cursor: "pointer",
    fontSize: 13,
  },
  panel: {
    marginTop: 4,
    padding: "8px 10px",
    background: "rgba(20,20,30,0.90)",
    color: "white",
    borderRadius: 10,
    maxHeight: 420,
    overflowY: "auto",
  },
  row: {
    display: "flex",
    alignItems: "center",
    cursor: "pointer",
    padding: "4px 0",
  },
  legend: {
    marginTop: 8,
    borderTop: "1px solid rgba(255,255,255,0.15)",
    paddingTop: 8,
  },
  legendTitle: {
    fontSize: 10,
    fontWeight: 600,
    opacity: 0.6,
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
    marginBottom: 6,
  },
  legendImg: {
    maxWidth: "100%",
    borderRadius: 4,
    background: "rgba(255,255,255,0.9)",
    padding: 4,
  },
};
