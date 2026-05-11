import { useQuery } from "@tanstack/react-query";

import {
  buildBanFormatAddress,
  createAnswer,
  createLead,
  findBuildingAtPoint,
  getDpeFromBanId,
  pickOfficialDpe,
  reverseGeocodeBan,
  upsertProjectFromAnswer,
} from "./argile-api/client";
import { dpeClassSchema } from "./argile-api/schemas";
import type { BuildingAnalysis } from "./argile-api/types";

/**
 * Click-to-analysis pipeline: locates the building under the click,
 * resolves a BAN address, creates a lead + answer, runs the project
 * sizing, and returns the DPE class plus the (answerId, leadToken) pair
 * that drives the deep-link to the acquisition wizard.
 *
 * Returns `null` (under `data`) when the click isn't on a building.
 */
export function useBuildingAnalysis(
  click: { lat: number; lng: number } | null,
): {
  data: BuildingAnalysis | null | undefined;
  isLoading: boolean;
  error: Error | null;
} {
  const query = useQuery<BuildingAnalysis | null, Error>({
    queryKey: ["buildingAnalysis", click?.lat, click?.lng],
    enabled: click != null,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async ({ signal }) => {
      if (!click) return null;
      return runBuildingAnalysis(click, signal);
    },
  });
  return { data: query.data, isLoading: query.isLoading, error: query.error };
}

async function runBuildingAnalysis(
  click: { lat: number; lng: number },
  signal: AbortSignal,
): Promise<BuildingAnalysis | null> {
  const building = await findBuildingAtPoint({ lat: click.lat, lng: click.lng, signal });
  if (!building) return null;

  const ban = await reverseGeocodeBan({ lat: building.lat, lng: building.lng, signal });
  const banFormat = ban ? buildBanFormatAddress(ban) : null;
  const fallbackLabel = `${building.lat.toFixed(5)}, ${building.lng.toFixed(5)}`;
  const displayAddress = {
    label: ban?.label ?? fallbackLabel,
    lat: building.lat,
    lng: building.lng,
  };

  const [lead, dpeRows] = await Promise.all([
    createLead({
      address: {
        label: ban?.label ?? fallbackLabel,
        postcode: ban?.postcode,
        city: ban?.city,
        street: ban?.street,
        lat: building.lat,
        lng: building.lng,
      },
      signal,
    }),
    ban?.banId ? getDpeFromBanId({ banId: ban.banId, signal }) : Promise.resolve([]),
  ]);

  const officialDpe = pickOfficialDpe(dpeRows);

  const answer = await createAnswer({
    leadToken: lead.token,
    leadId: lead.id,
    geopfId: building.geopf_id,
    address: banFormat ?? displayAddress,
    officialDpeId: officialDpe?.numero_dpe_audit,
    signal,
  });

  // PUT /answers/{id}/project — same call argile-web-ui's
  // useProjectFromAnswer makes; produces an ep_conso even without an
  // official DPE id (fall-back per-building estimate).
  let dpe: BuildingAnalysis["dpe"] = null;
  if (banFormat) {
    const project = await upsertProjectFromAnswer({
      answerId: answer.id,
      leadToken: lead.token,
      signal,
    });
    const ep = project?.data?.sortie?.ep_conso;
    const cls = ep?.classe_bilan_dpe?.toUpperCase();
    const parsed = cls ? dpeClassSchema.safeParse(cls) : null;
    if (parsed?.success) {
      dpe = {
        value: parsed.data,
        consoKwhEpM2: ep?.ep_conso_5_usages_m2 ?? undefined,
        visitDate: officialDpe?.visit_date,
      };
    }
  }

  return {
    building: { geopfId: building.geopf_id, lat: building.lat, lng: building.lng },
    address: displayAddress,
    dpe,
    answerId: answer.id,
    leadToken: lead.token,
  };
}
