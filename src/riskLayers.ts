/**
 * Georisques WMS overlay layers for climate risk visualization.
 *
 * All layers come from the same WMS endpoint:
 *   https://www.georisques.gouv.fr/services
 *
 * They're added as MapLibre raster sources + layers and toggled
 * via the UI panel. Each layer has a unique id, a human label,
 * a WMS layer name, and an optional legend color for the toggle.
 */

export type RiskLayerDef = {
  /** Unique id used as MapLibre source + layer id. */
  id: string;
  /** Display label in the toggle panel. */
  label: string;
  /** WMS LAYERS parameter value. */
  wmsLayer: string;
  /** Category for grouping in the UI. */
  category: "argile" | "feu" | "inondation" | "gaspar";
  /** Legend swatch color (CSS). */
  color: string;
  /** Default visibility. */
  defaultVisible: boolean;
};

export const RISK_LAYERS: RiskLayerDef[] = [
  // -- Retrait-gonflement des argiles --
  {
    id: "rga-alea",
    label: "Aléa argile (RGA)",
    wmsLayer: "ALEARG",
    category: "argile",
    color: "#d97706",
    defaultVisible: false,
  },
  {
    id: "rga-sinistralite",
    label: "Sinistralité argile",
    wmsLayer: "ALEARG_REALISE",
    category: "argile",
    color: "#b45309",
    defaultVisible: false,
  },
  {
    id: "pprn-argile",
    label: "PPRn argile (approuvé)",
    wmsLayer: "PPRN_COMMUNE_ARGILE_APPROUV",
    category: "argile",
    color: "#92400e",
    defaultVisible: false,
  },

  // -- Feux de forêt --
  {
    id: "pprn-feu-approuve",
    label: "PPRn feu de forêt (approuvé)",
    wmsLayer: "PPRN_COMMUNE_FEU_APPROUV",
    category: "feu",
    color: "#dc2626",
    defaultVisible: false,
  },
  {
    id: "pprn-feu-zone",
    label: "Zones PPRn feu",
    wmsLayer: "PPRN_ZONE_FEU",
    category: "feu",
    color: "#ef4444",
    defaultVisible: false,
  },
  {
    id: "sup-feu",
    label: "Servitudes feu de forêt",
    wmsLayer: "SUP_FEU",
    category: "feu",
    color: "#f87171",
    defaultVisible: false,
  },

  // -- Inondation --
  {
    id: "pprn-inond-approuve",
    label: "PPRn inondation (approuvé)",
    wmsLayer: "PPRN_COMMUNE_RISQINOND_APPROUV",
    category: "inondation",
    color: "#2563eb",
    defaultVisible: false,
  },
  {
    id: "pprn-inond-zone",
    label: "Zones PPRn inondation",
    wmsLayer: "PPRN_ZONE_INOND",
    category: "inondation",
    color: "#3b82f6",
    defaultVisible: false,
  },

  // -- GASPAR (transversal) --
  {
    id: "gaspar-pprn",
    label: "Communes GASPAR (PPRn)",
    wmsLayer: "PPRN_COMMUNE_GASPAR",
    category: "gaspar",
    color: "#7c3aed",
    defaultVisible: false,
  },
];

const WMS_BASE = "https://www.georisques.gouv.fr/services";

/**
 * Build the WMS tile URL template for MapLibre's raster source.
 * MapLibre replaces {bbox-epsg-3857} at runtime with the tile's bbox.
 */
export function wmsUrl(wmsLayer: string): string {
  return (
    `${WMS_BASE}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap` +
    `&LAYERS=${wmsLayer}` +
    `&CRS=EPSG:3857` +
    `&BBOX={bbox-epsg-3857}` +
    `&WIDTH=256&HEIGHT=256` +
    `&FORMAT=image/png` +
    `&TRANSPARENT=true`
  );
}
