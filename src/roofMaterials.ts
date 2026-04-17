/**
 * Map BDNB's `mat_toit_txt` free-ish string to a small enum of material
 * categories + a display color. The smoke-test render colors roofs by this
 * category; textures are a later follow-up.
 *
 * BDNB vocabulary seen in the wild (Fichiers Fonciers / MAJIC):
 *   TUILES, ARDOISES, ZINC ALUMINIUM, BETON, AUTRES, INDETERMINE, NULL,
 *   plus 10 combinations separated by " - " (e.g. "TUILES - ZINC ALUMINIUM").
 * Mixed rows map to their first term — good enough for a single-color
 * render; a follow-up can split the roof faces.
 */

export type RoofMaterial = "tuiles" | "ardoises" | "zinc" | "beton" | "autres" | "unknown";

/** RGB 0–255. Alpha is left to the caller so the layer can mix transparency. */
export const ROOF_COLORS: Record<RoofMaterial, [number, number, number]> = {
  tuiles: [170, 74, 55], //  warm terracotta
  ardoises: [75, 82, 97], //  bluish slate grey
  zinc: [160, 168, 175], //  pale zinc
  beton: [150, 148, 140], //  neutral concrete
  autres: [195, 175, 140], //  warm beige
  unknown: [210, 195, 170], //  faint fallback (same hue family as the body color)
};

export function classifyRoofMaterial(raw: string | null | undefined): RoofMaterial {
  if (!raw) return "unknown";
  const first = raw.split(" - ")[0]?.trim().toUpperCase() ?? "";
  if (first === "TUILES") return "tuiles";
  if (first === "ARDOISES") return "ardoises";
  if (first === "ZINC ALUMINIUM") return "zinc";
  if (first === "BETON") return "beton";
  if (first === "AUTRES") return "autres";
  // INDETERMINE and anything else unrecognized falls through as unknown.
  return "unknown";
}
