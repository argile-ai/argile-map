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
  /** Default visibility. */
  defaultVisible: boolean;
};

export const RISK_LAYERS: RiskLayerDef[] = [
  {
    id: "rga-alea",
    label: "Aléa argile (RGA)",
    wmsLayer: "ALEARG",
    defaultVisible: false,
  },
  {
    id: "radon",
    label: "Potentiel radon",
    wmsLayer: "RADON",
    defaultVisible: false,
  },
  {
    id: "pprn-feu-zone",
    label: "Zones feux de forêt",
    wmsLayer: "PPRN_ZONE_FEU",
    defaultVisible: false,
  },
  {
    id: "pprn-inond-zone",
    label: "Zones inondation",
    wmsLayer: "PPRN_ZONE_INOND",
    defaultVisible: false,
  },
  {
    id: "gaspar-pprn",
    label: "Communes à risque (GASPAR)",
    wmsLayer: "PPRN_COMMUNE_GASPAR",
    defaultVisible: false,
  },
];

export const WMS_BASE = "https://www.georisques.gouv.fr/services";

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

/** WMS GetLegendGraphic URL for a given layer. */
export function legendUrl(wmsLayer: string): string {
  return (
    `${WMS_BASE}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetLegendGraphic` +
    `&LAYER=${wmsLayer}&FORMAT=image/png&SLD_VERSION=1.1.0`
  );
}
