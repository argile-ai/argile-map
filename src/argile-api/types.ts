import type { BanFormatAddress, DpeClass } from "./schemas";

/** Click-to-analysis output that drives the popup. */
export type BuildingAnalysis = {
  building: { geopfId: string; lat: number; lng: number };
  address: { label: string; lat: number; lng: number };
  /** Stripped of nulls/undefineds so the popup just renders fields. */
  dpe: DpeInfo | null;
  /** IDs to deep-link into `app.argile.ai/acquisition/building?a=&t=`. */
  answerId: string;
  leadToken: string;
};

export type DpeInfo = {
  value: DpeClass;
  /** kWh ep / m² / year, when computed by the project sizing. */
  consoKwhEpM2?: number;
  /** ISO date of the official DPE diagnostic, when grounded in a real one. */
  visitDate?: string;
};

/** BAN reverse-geocode result post-validation, with camelCase fields. */
export type BanReverseResult = {
  label: string;
  banId?: string;
  postcode?: string;
  city?: string;
  street?: string;
  housenumber?: string;
  citycode?: string;
  type?: string;
  x?: number;
  y?: number;
};

export type { BanFormatAddress, DpeClass };
