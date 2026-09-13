/**
 * Traduction des valeurs techniques de la base en libellés contractuels.
 *
 * Les colonnes `application_guarantees.kind`, `application_insurances.coverage`,
 * `status`, `payment_status` ou `client_choice` stockent des identifiants
 * (`credit_risk_cover`, `awaiting_payment`, `pay_now`…). Ces identifiants ne
 * doivent JAMAIS apparaître dans un document contractuel : ils sont convertis
 * ici en libellé traduit du dictionnaire documentaire (`enums.*`).
 *
 * Règles :
 *  - une valeur connue est traduite dans la langue du document ;
 *  - une valeur libre saisie par l'administrateur (texte avec espaces, accents,
 *    majuscules) est restituée telle quelle ;
 *  - un identifiant inconnu est humanisé (`some_value` → « Some value »), afin
 *    qu'aucune clé brute ne soit imprimée.
 */
import { docTextOrNull } from "@/lib/pdf/doc-i18n.server";

export type EnumGroup =
  | "guaranteeKind"
  | "insuranceCoverage"
  | "status"
  | "paymentStatus"
  | "clientChoice"
  | "signatureProvider";

/** `credit_risk_cover` → `credit_risk_cover` ; « Décès / invalidité » → null. */
function slugify(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/[^a-zA-Z0-9_\- ]/.test(trimmed)) return null;
  const slug = trimmed.toLowerCase().replace(/[\s-]+/g, "_");
  return /^[a-z0-9]+(_[a-z0-9]+)*$/.test(slug) ? slug : null;
}

/** `credit_risk_cover` → « Credit risk cover » (dernier filet de sécurité). */
function humanize(slug: string): string {
  const words = slug.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Libellé traduit d'une valeur technique.
 * Renvoie `null` si la valeur est vide (l'appelant décide alors d'omettre la ligne).
 */
export function docEnum(
  language: string | null | undefined,
  group: EnumGroup,
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const slug = slugify(raw);
  // Texte libre (multi-mots accentués, phrase saisie au back-office).
  if (!slug) return raw;

  const translated = docTextOrNull(language, `enums.${group}.${slug}`);
  if (translated) return translated;

  const shared = docTextOrNull(language, `enums.common.${slug}`);
  if (shared) return shared;

  // Valeur libre en un seul mot (« Allianz ») : conservée telle quelle.
  if (!raw.includes("_") && raw !== raw.toLowerCase()) return raw;
  return humanize(slug);
}

/** Variante avec repli explicite (utilisée quand une ligne est obligatoire). */
export function docEnumOr(
  language: string | null | undefined,
  group: EnumGroup,
  value: string | null | undefined,
  fallback: string,
): string {
  return docEnum(language, group, value) ?? fallback;
}
