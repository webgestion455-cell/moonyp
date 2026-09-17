/**
 * Adresse du siège social — source unique, localisée.
 *
 * Une adresse postale ne se traduit pas : la voie et la ville restent telles
 * qu'elles figurent au registre (« 1 Centenary Square, Birmingham »). Seul le
 * nom du pays est rendu dans la langue de l'interface, comme le fait toute
 * banque européenne sur ses documents multilingues. Ce module est sans effet
 * de bord et utilisable à l'identique dans le navigateur, les e-mails et les
 * PDF.
 */

import { countryName } from "@/lib/countries";

export const BRAND_ADDRESS = {
  street: "1 Centenary Square",
  city: "Birmingham",
  postcode: "B1 2DR",
  /** ISO 3166-1 alpha-2 : le nom traduit vient de `countries.ts`. */
  country: "GB",
} as const;

export type BrandAddressLines = { street: string; locality: string; country: string };

/** Nom du pays du siège dans la langue demandée (repli anglais). */
export function brandCountryName(language: string | null | undefined): string {
  return countryName(BRAND_ADDRESS.country, (language ?? "en").slice(0, 2).toLowerCase());
}

/**
 * Lignes de l'adresse, prêtes à afficher :
 *   street   → « 1 Centenary Square »
 *   locality → « Birmingham, B1 2DR »
 *   country  → « Royaume-Uni » (selon la langue)
 */
export function brandAddressLines(language: string | null | undefined): BrandAddressLines {
  return {
    street: BRAND_ADDRESS.street,
    locality: `${BRAND_ADDRESS.city}, ${BRAND_ADDRESS.postcode}`,
    country: brandCountryName(language),
  };
}

/**
 * Adresse sur une ligne, dans la langue demandée.
 * `withCountry: false` omet le pays (pied de page compact).
 */
export function formatBrandAddress(
  language: string | null | undefined,
  options: { withCountry?: boolean } = {},
): string {
  const lines = brandAddressLines(language);
  const parts = [lines.street, lines.locality];
  if (options.withCountry !== false) parts.push(lines.country);
  return parts.join(", ");
}
