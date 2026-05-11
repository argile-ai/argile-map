import { z } from "zod";

/** ADEME energy-class letter (A best, G worst). */
export const dpeClassSchema = z.enum(["A", "B", "C", "D", "E", "F", "G"]);
export type DpeClass = z.infer<typeof dpeClassSchema>;

/**
 * BAN reverse-geocode response, narrowed to the fields we use.
 *
 * Two coordinate gotchas:
 *   - `street` is the street name only ("Rue de l'Oppidum"); `name` is the
 *     housenumber-prefixed full ("21 Rue de l'Oppidum"). Reading `name` as
 *     the street produces an `adresse_brut` of "21 21 Rue …".
 *   - `geometry.coordinates` is WGS84 `[lng, lat]`. `properties.x/y` is
 *     Lambert93 (EPSG:2154). argile-web-ui's `BanFormat.banX/banY` is
 *     populated from the WGS84 geometry (see `addressHelpers.ts:28-29`),
 *     and the wizard Map computes its center via
 *     `{lat: banY, lng: banX}` — so banX must be lng, not Lambert93 X.
 */
export const banReverseSchema = z.object({
  features: z
    .array(
      z.object({
        geometry: z.object({
          coordinates: z.tuple([z.number(), z.number()]),
        }),
        properties: z.object({
          label: z.string(),
          id: z.string().optional(),
          postcode: z.string().optional(),
          city: z.string().optional(),
          street: z.string().optional(),
          housenumber: z.string().optional(),
          citycode: z.string().optional(),
          type: z.string().optional(),
        }),
      }),
    )
    .min(0),
});

/**
 * Snake-case BAN-format address that `PUT /answers/{id}/project` requires
 * (rejects with "adresse_brut must be provided" otherwise). The argile
 * backend deserializes this directly into `BanFormat` from
 * `argile-web-ui/forms/addresses/types.ts`.
 */
export const banFormatAddressSchema = z.object({
  adresse_brut: z.string(),
  code_postal_brut: z.string(),
  nom_commune_brut: z.string(),
  label_brut: z.string(),
  label_brut_avec_complement: z.string(),
  ban_id: z.string(),
  ban_label: z.string(),
  ban_housenumber: z.string().nullable(),
  ban_street: z.string().nullable(),
  ban_citycode: z.string().nullable(),
  ban_postcode: z.string(),
  ban_city: z.string(),
  ban_type: z.string().nullable(),
  ban_x: z.number().nullable(),
  ban_y: z.number().nullable(),
});
export type BanFormatAddress = z.infer<typeof banFormatAddressSchema>;

/** `POST /leads` returns lead + token. We only read the two fields we need. */
export const leadWithTokenSchema = z.object({
  id: z.string(),
  token: z.string(),
});
export type LeadWithToken = z.infer<typeof leadWithTokenSchema>;

/**
 * `POST /open-data/auto-complete` returns the FlashDiag enriched with
 * BDNB/cadastre values that the wizard Building step needs (building type,
 * walls, year, surface, heating, etc.). We pass the whole payload through
 * to `answer.data` rather than narrow to a brittle subset — the backend
 * is authoritative on what fields exist.
 */
export const enrichedFlashDiagSchema = z.record(z.string(), z.unknown());
export type EnrichedFlashDiag = z.infer<typeof enrichedFlashDiagSchema>;

/** `POST /answers` returns the created answer; we only need its id. */
export const answerCreatedSchema = z.object({ id: z.string() });

/**
 * One row of `GET /from-ban-id/{banId}`. The interesting bits live deep in
 * `logement.sortie.ep_conso`; everything else passes through as opaque.
 */
export const fromBanIdRowSchema = z.object({
  numero_dpe_audit: z.string().optional(),
  visit_date: z.string().optional(),
  logement: z
    .object({
      sortie: z
        .object({
          ep_conso: z
            .object({
              classe_bilan_dpe: z.string().nullable().optional(),
              ep_conso_5_usages: z.number().nullable().optional(),
              ep_conso_5_usages_m2: z.number().nullable().optional(),
            })
            .optional(),
        })
        .optional(),
    })
    .optional(),
});
export type FromBanIdRow = z.infer<typeof fromBanIdRowSchema>;

export const fromBanIdResponseSchema = z.array(fromBanIdRowSchema);

/**
 * `PUT /answers/{id}/project` returns a `ProjectRead`. Same path the
 * acquisition wizard reads: `data.sortie.ep_conso.classe_bilan_dpe`.
 */
export const projectSizingSchema = z.object({
  data: z
    .object({
      sortie: z
        .object({
          ep_conso: z
            .object({
              classe_bilan_dpe: z.string().nullable().optional(),
              ep_conso_5_usages_m2: z.number().nullable().optional(),
            })
            .optional(),
          emission_ges: z
            .object({ classe_emission_ges: z.string().nullable().optional() })
            .nullable()
            .optional(),
        })
        .optional(),
    })
    .optional(),
});
export type ProjectSizing = z.infer<typeof projectSizingSchema>;
