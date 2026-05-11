import { z } from "zod";

/** ADEME energy-class letter (A best, G worst). */
export const dpeClassSchema = z.enum(["A", "B", "C", "D", "E", "F", "G"]);
export type DpeClass = z.infer<typeof dpeClassSchema>;

/** BAN reverse-geocode response, narrowed to the fields we use. */
export const banReverseSchema = z.object({
  features: z
    .array(
      z.object({
        properties: z.object({
          label: z.string(),
          id: z.string().optional(),
          postcode: z.string().optional(),
          city: z.string().optional(),
          name: z.string().optional(),
          housenumber: z.string().optional(),
          citycode: z.string().optional(),
          type: z.string().optional(),
          x: z.number().optional(),
          y: z.number().optional(),
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
