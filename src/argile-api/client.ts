/**
 * Thin wrappers around the api.argile.ai endpoints used by the building
 * popup. Same calls argile-web-ui makes (`useDpeFromBanId`, `createLead`,
 * `createAnswer`, `useProjectFromAnswer.createForAnswer`) just rebuilt as
 * dependency-free async functions so the popup can compose them with
 * react-query.
 */
import { config } from "../config";
import type { CityJsonBuilding, CityJsonSearchResponse } from "../types";
import {
  answerCreatedSchema,
  type BanFormatAddress,
  banReverseSchema,
  type FromBanIdRow,
  fromBanIdResponseSchema,
  type LeadWithToken,
  leadWithTokenSchema,
  type ProjectSizing,
  projectSizingSchema,
} from "./schemas";
import type { BanReverseResult } from "./types";

/**
 * Find the building under a click. /cityjson/search supports a center+radius
 * query — we use radius=8m and pick the closest match to the click point.
 */
export async function findBuildingAtPoint(params: {
  lat: number;
  lng: number;
  signal?: AbortSignal;
}): Promise<CityJsonBuilding | null> {
  const { lat, lng, signal } = params;
  const response = await fetch(`${config.apiUrl}/cityjson/search`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ center: [lat, lng], radius_m: 8, limit: 5 }),
  });
  if (!response.ok) return null;
  const data = (await response.json()) as CityJsonSearchResponse;
  if (!data.buildings.length) return null;
  let best = data.buildings[0];
  let bestD = Number.POSITIVE_INFINITY;
  for (const b of data.buildings) {
    const d = (b.lat - lat) ** 2 + (b.lng - lng) ** 2;
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

/** BAN reverse-geocode (api-adresse.data.gouv.fr — public, no auth). */
export async function reverseGeocodeBan(params: {
  lat: number;
  lng: number;
  signal?: AbortSignal;
}): Promise<BanReverseResult | null> {
  const { lat, lng, signal } = params;
  const url = `https://api-adresse.data.gouv.fr/reverse/?lon=${lng}&lat=${lat}&limit=1`;
  const response = await fetch(url, { signal });
  if (!response.ok) return null;
  const parsed = banReverseSchema.safeParse(await response.json());
  if (!parsed.success) return null;
  const p = parsed.data.features[0]?.properties;
  if (!p) return null;
  return {
    label: p.label,
    banId: p.id,
    postcode: p.postcode,
    city: p.city,
    street: p.name,
    housenumber: p.housenumber,
    citycode: p.citycode,
    type: p.type,
    x: p.x,
    y: p.y,
  };
}

/** Translate a BAN reverse-geocode result into the snake_case BAN format
 * that `PUT /answers/{id}/project` expects. Returns null when the result
 * is too sparse to satisfy the sizing endpoint's "adresse_brut" rule. */
export function buildBanFormatAddress(p: BanReverseResult): BanFormatAddress | null {
  if (!p.banId || !p.postcode || !p.city) return null;
  const adresseBrut =
    p.housenumber && p.street ? `${p.housenumber} ${p.street}` : (p.street ?? p.label);
  return {
    adresse_brut: adresseBrut,
    code_postal_brut: p.postcode,
    nom_commune_brut: p.city,
    label_brut: p.label,
    label_brut_avec_complement: p.label,
    ban_id: p.banId,
    ban_label: p.label,
    ban_housenumber: p.housenumber ?? null,
    ban_street: p.street ?? null,
    ban_citycode: p.citycode ?? null,
    ban_postcode: p.postcode,
    ban_city: p.city,
    ban_type: p.type ?? null,
    ban_x: p.x ?? null,
    ban_y: p.y ?? null,
  };
}

/** Real ADEME DPE records for a BAN address. Returns [] when none exists. */
export async function getDpeFromBanId(params: {
  banId: string;
  signal?: AbortSignal;
}): Promise<FromBanIdRow[]> {
  const { banId, signal } = params;
  const response = await fetch(
    `${config.argileApiUrl}/from-ban-id/${encodeURIComponent(banId)}`,
    { signal },
  );
  if (!response.ok) return [];
  const parsed = fromBanIdResponseSchema.safeParse(await response.json());
  return parsed.success ? parsed.data : [];
}

/**
 * Pick the most recent record that has a `numero_dpe_audit` plus a
 * non-null `classe_bilan_dpe` — that's the official DPE id we hand back
 * to the answer to ground the project sizing in a real diagnostic.
 */
export function pickOfficialDpe(rows: FromBanIdRow[]): FromBanIdRow | null {
  const valid = rows.filter(
    (r) => !!r.numero_dpe_audit && !!r.logement?.sortie?.ep_conso?.classe_bilan_dpe,
  );
  if (valid.length === 0) return null;
  valid.sort((a, b) => (b.visit_date ?? "").localeCompare(a.visit_date ?? ""));
  return valid[0];
}

/** Anonymous lead creation — branchId defaults to argile.ai's main branch. */
export async function createLead(params: {
  address: {
    label: string;
    postcode?: string;
    city?: string;
    street?: string;
    lat: number;
    lng: number;
  };
  signal?: AbortSignal;
}): Promise<LeadWithToken> {
  const { address, signal } = params;
  const response = await fetch(`${config.argileApiUrl}/leads`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      branch_id: config.argileBranchId,
      status_slug: "acquisition_simulateur",
      tax_shares: 2,
      address,
    }),
  });
  if (!response.ok) throw new Error(`api.argile.ai /leads ${response.status}`);
  return leadWithTokenSchema.parse(await response.json());
}

/**
 * Create the answer the wizard consumes on landing. `address` should be
 * the full BAN format; passing a sparse address still creates the answer
 * (deep-link works) but `PUT /project` will then 422.
 */
export async function createAnswer(params: {
  leadToken: string;
  leadId: string;
  geopfId: string;
  address: BanFormatAddress | { label: string; lat: number; lng: number };
  officialDpeId?: string;
  signal?: AbortSignal;
}): Promise<{ id: string }> {
  const { leadToken, leadId, geopfId, address, officialDpeId, signal } = params;
  const data: Record<string, unknown> = { workflow: "oneclick", geopfId, address };
  if (officialDpeId) data.official_dpe_id = officialDpeId;
  const response = await fetch(`${config.argileApiUrl}/answers`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${leadToken}`,
    },
    body: JSON.stringify({ lead_id: leadId, data }),
  });
  if (!response.ok) throw new Error(`api.argile.ai /answers ${response.status}`);
  return answerCreatedSchema.parse(await response.json());
}

/**
 * Trigger project sizing — same call as `useProjectFromAnswer.createForAnswer`.
 * Returns the full project; the popup reads `data.sortie.ep_conso.*`.
 */
export async function upsertProjectFromAnswer(params: {
  answerId: string;
  leadToken: string;
  signal?: AbortSignal;
}): Promise<ProjectSizing | null> {
  const { answerId, leadToken, signal } = params;
  const response = await fetch(
    `${config.argileApiUrl}/answers/${encodeURIComponent(answerId)}/project`,
    {
      method: "PUT",
      signal,
      headers: { Authorization: `Bearer ${leadToken}`, "Content-Type": "application/json" },
    },
  );
  if (!response.ok) return null;
  const parsed = projectSizingSchema.safeParse(await response.json());
  return parsed.success ? parsed.data : null;
}
