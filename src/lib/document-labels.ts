/**
 * Correspondance entre les slugs du catalogue `document_types` et les clés i18n.
 *
 * Le catalogue en base porte une colonne `i18n_key` (source de vérité), mais
 * certains écrans ne disposent que du slug du document (portail sécurisé,
 * historiques, notifications). Cette table permet de traduire un document
 * partout, sans jamais afficher une clé brute ni un libellé français figé.
 */
export const DOCUMENT_SLUG_I18N_KEY: Record<string, string> = {
  // Identité
  id_national_id: "kyc.docs.nationalId",
  id_passport: "kyc.docs.passport",
  id_driving_licence: "kyc.docs.drivingLicence",
  id_residence_permit: "kyc.docs.residencePermit",
  // Domicile
  address_electricity: "kyc.docs.electricity",
  address_water: "kyc.docs.water",
  address_telecom: "kyc.docs.telecom",
  address_hosting: "kyc.docs.hosting",
  // Biométrie
  selfie_liveness: "kyc.docs.selfie",
  // Bancaire
  bank_statement: "kyc.docs.bankStatement",
  // Revenus
  income_payslip: "kyc.docs.payslip",
  income_tax_return: "kyc.docs.taxReturn",
  income_pension: "kyc.docs.pension",
  income_benefits: "kyc.docs.benefits",
  income_kbis: "kyc.docs.kbis",
  // Catalogue historique (compatibilité ascendante)
  identity: "documents.identity",
  proof_address: "documents.proofAddress",
  income: "documents.income",
  proof_income: "documents.income",
  rib: "documents.rib",
  other: "documents.other",
  id_front: "kyc.docs.nationalId",
  id_back: "kyc.docs.nationalId",
  selfie: "kyc.docs.selfie",
};

type TFunc = (key: string, options?: Record<string, unknown>) => unknown;

/** Renvoie toujours une chaîne : jamais un objet, jamais une clé brute. */
export function translateOrNull(t: TFunc, key: string | null | undefined): string | null {
  if (!key) return null;
  const value = t(key, { defaultValue: "" });
  if (typeof value !== "string" || !value.trim()) return null;
  return value;
}

/**
 * Libellé traduit d'un document.
 * Ordre : clé i18n explicite → clé déduite du slug → libellé du catalogue → slug.
 */
export function documentLabel(
  t: TFunc,
  slug: string,
  i18nKey?: string | null,
  fallbackLabel?: string | null,
): string {
  return (
    translateOrNull(t, i18nKey) ??
    translateOrNull(t, DOCUMENT_SLUG_I18N_KEY[slug]) ??
    (fallbackLabel?.trim() || slug)
  );
}
