/**
 * Toggleable panel for Géorisques WMS risk overlay layers.
 * Each checkbox adds/removes a raster WMS source + layer from the
 * MapLibre map instance.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { RISK_LAYERS, wmsUrl, type RiskLayerDef } from "./riskLayers";

type Props = {
  mapRef: React.RefObject<MapRef | null>;
};

const CATEGORIES: { key: RiskLayerDef["category"]; label: string }[] = [
  { key: "argile", label: "Retrait-gonflement argiles" },
  { key: "feu", label: "Feux de forêt" },
  { key: "inondation", label: "Inondation" },
  { key: "gaspar", label: "GASPAR" },
];

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
  const [visible, setVisible] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const l of RISK_LAYERS) if (l.defaultVisible) s.add(l.id);
    return s;
  });
  // Track which layers we've added to the map so cleanup works on unmount.
  const addedRef = useRef(new Set<string>());

  const toggle = useCallback(
    (id: string) => {
      setVisible((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [],
  );

  // Sync MapLibre layers with the visible set.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !map.isStyleLoaded()) return;

    for (const def of RISK_LAYERS) {
      if (visible.has(def.id)) {
        ensureWmsLayer(map, def);
        addedRef.current.add(def.id);
      } else {
        removeWmsLayer(map, def.id);
        addedRef.current.delete(def.id);
      }
    }
  }, [visible, mapRef]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      const map = mapRef.current?.getMap();
      if (!map) return;
      for (const id of addedRef.current) removeWmsLayer(map, id);
    };
  }, [mapRef]);

  return (
    <div style={styles.wrapper}>
      <button type="button" style={styles.toggle} onClick={() => setOpen((o) => !o)}>
        <span style={{ fontSize: 16 }}>&#x1f5fa;</span>{" "}
        <span style={{ fontSize: 13 }}>Couches risques</span>
        <span style={{ marginLeft: "auto", fontSize: 10 }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={styles.panel}>
          {CATEGORIES.map((cat) => {
            const layers = RISK_LAYERS.filter((l) => l.category === cat.key);
            if (layers.length === 0) return null;
            return (
              <div key={cat.key} style={{ marginBottom: 8 }}>
                <div style={styles.catLabel}>{cat.label}</div>
                {layers.map((l) => (
                  <label key={l.id} style={styles.row}>
                    <input
                      type="checkbox"
                      checked={visible.has(l.id)}
                      onChange={() => toggle(l.id)}
                      style={{ marginRight: 6 }}
                    />
                    <span
                      style={{
                        ...styles.swatch,
                        background: l.color,
                      }}
                    />
                    <span style={{ fontSize: 12 }}>{l.label}</span>
                  </label>
                ))}
              </div>
            );
          })}
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
    maxWidth: 260,
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
    maxHeight: 340,
    overflowY: "auto",
  },
  catLabel: {
    fontSize: 11,
    fontWeight: 600,
    opacity: 0.6,
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
    marginBottom: 4,
  },
  row: {
    display: "flex",
    alignItems: "center",
    cursor: "pointer",
    padding: "3px 0",
  },
  swatch: {
    display: "inline-block",
    width: 10,
    height: 10,
    borderRadius: 2,
    marginRight: 6,
    flexShrink: 0,
  },
};
