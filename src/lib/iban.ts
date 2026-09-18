/**
 * Banking identifier validation — real IBAN/BIC rules, not a loose regex.
 *
 * Shared by the client (instant feedback) and by the server functions
 * (authoritative re-validation before an application is accepted).
 */

import { SEPA_COUNTRIES, countryByCode } from "@/lib/countries";

/** Official IBAN length per country (ISO 13616 registry). */
export const IBAN_LENGTHS: Record<string, number> = {
  AD: 24,
  AE: 23,
  AL: 28,
  AT: 20,
  AZ: 28,
  BA: 20,
  BE: 16,
  BG: 22,
  BH: 22,
  BI: 27,
  BR: 29,
  BY: 28,
  CH: 21,
  CR: 22,
  CY: 28,
  CZ: 24,
  DE: 22,
  DJ: 27,
  DK: 18,
  DO: 28,
  EE: 20,
  EG: 29,
  ES: 24,
  FI: 18,
  FO: 18,
  FR: 27,
  GB: 22,
  GE: 22,
  GI: 23,
  GL: 18,
  GR: 27,
  GT: 28,
  HR: 21,
  HU: 28,
  IE: 22,
  IL: 23,
  IQ: 23,
  IS: 26,
  IT: 27,
  JO: 30,
  KW: 30,
  KZ: 20,
  LB: 28,
  LC: 32,
  LI: 21,
  LT: 20,
  LU: 20,
  LV: 21,
  LY: 25,
  MC: 27,
  MD: 24,
  ME: 22,
  MK: 19,
  MR: 27,
  MT: 31,
  MU: 30,
  NL: 18,
  NO: 15,
  PK: 24,
  PL: 28,
  PS: 29,
  PT: 25,
  QA: 29,
  RO: 24,
  RS: 22,
  RU: 33,
  SA: 24,
  SC: 31,
  SD: 18,
  SE: 24,
  SI: 19,
  SK: 24,
  SM: 27,
  SO: 23,
  ST: 25,
  SV: 28,
  TL: 23,
  TN: 24,
  TR: 26,
  UA: 29,
  VA: 22,
  VG: 24,
  XK: 20,
};

export function normaliseIban(value: string): string {
  return (value ?? "").replace(/[\s-]+/g, "").toUpperCase();
}

/** Groups an IBAN four characters at a time, the way banks print it. */
export function formatIban(value: string): string {
  return normaliseIban(value)
    .replace(/(.{4})/g, "$1 ")
    .trim();
}

/** ISO 7064 MOD-97-10 checksum. Big-integer safe (chunked modulo). */
function mod97(digits: string): number {
  let remainder = 0;
  for (let i = 0; i < digits.length; i += 7) {
    remainder = Number(String(remainder) + digits.slice(i, i + 7)) % 97;
  }
  return remainder;
}

export type IbanCheck =
  | { valid: true; country: string; masked: string; sepa: boolean }
  | { valid: false; reason: "empty" | "charset" | "country" | "length" | "checksum" };

export function validateIban(input: string): IbanCheck {
  const iban = normaliseIban(input);
  if (!iban) return { valid: false, reason: "empty" };
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(iban)) return { valid: false, reason: "charset" };

  const country = iban.slice(0, 2);
  const expected = IBAN_LENGTHS[country];
  if (!expected) {
    // Country outside the IBAN registry: reject rather than silently accept.
    return { valid: false, reason: countryByCode(country) ? "country" : "country" };
  }
  if (iban.length !== expected) return { valid: false, reason: "length" };

  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  if (mod97(numeric) !== 1) return { valid: false, reason: "checksum" };

  return { valid: true, country, masked: maskIban(iban), sepa: SEPA_COUNTRIES.has(country) };
}

export function ibanCountry(input: string): string | null {
  const iban = normaliseIban(input);
  return /^[A-Z]{2}/.test(iban) ? iban.slice(0, 2) : null;
}

export function maskIban(input: string | null | undefined): string {
  const iban = normaliseIban(input ?? "");
  if (iban.length < 8) return "••••";
  return `${iban.slice(0, 4)} •••• •••• ${iban.slice(-4)}`;
}

/** ISO 9362 BIC: 4 bank + 2 country + 2 location (+ optional 3 branch). */
export function validateBic(input: string): { valid: boolean; country: string | null } {
  const bic = (input ?? "").replace(/\s+/g, "").toUpperCase();
  if (!bic) return { valid: false, country: null };
  const ok = /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic);
  return { valid: ok, country: ok ? bic.slice(4, 6) : null };
}

export interface PayoutInput {
  bank_holder: string;
  bank_iban: string;
  bank_bic?: string;
  bank_country?: string;
  /** Identity data captured earlier in the journey. */
  first_name?: string;
  last_name?: string;
  residence_country?: string;
}

export type PayoutIssue = {
  field: "bank_iban" | "bank_bic" | "bank_holder" | "bank_country";
  code: string;
  /** `error` blocks submission, `warning` routes the file to manual review. */
  severity: "error" | "warning";
};

const strip = (s: string) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim();

/**
 * Full banking coherence audit. Hard failures block the submission; soft
 * mismatches (holder spelling, cross-border account) flag the file for a
 * manual compliance review instead of silently accepting it.
 */
export function auditPayout(input: PayoutInput): {
  issues: PayoutIssue[];
  requiresReview: boolean;
  valid: boolean;
} {
  const issues: PayoutIssue[] = [];

  const iban = validateIban(input.bank_iban);
  if (!iban.valid) {
    issues.push({ field: "bank_iban", code: `iban.${iban.reason}`, severity: "error" });
  }

  const bicRaw = (input.bank_bic ?? "").trim();
  const bic = bicRaw ? validateBic(bicRaw) : null;
  if (bicRaw && bic && !bic.valid) {
    issues.push({ field: "bank_bic", code: "bic.format", severity: "error" });
  }

  if (iban.valid && bic?.valid && bic.country && bic.country !== iban.country) {
    issues.push({ field: "bank_bic", code: "bic.countryMismatch", severity: "error" });
  }

  if (iban.valid && input.bank_country) {
    const declared = input.bank_country.toUpperCase();
    if (declared !== iban.country) {
      issues.push({ field: "bank_country", code: "bank.countryMismatch", severity: "error" });
    }
  }

  // Holder must plausibly be the applicant — third-party payouts need review.
  const holder = strip(input.bank_holder);
  const first = strip(input.first_name ?? "");
  const last = strip(input.last_name ?? "");
  if (!holder) {
    issues.push({ field: "bank_holder", code: "holder.required", severity: "error" });
  } else if (last && !holder.includes(last)) {
    issues.push({ field: "bank_holder", code: "holder.mismatch", severity: "warning" });
  } else if (first && !holder.includes(first)) {
    issues.push({ field: "bank_holder", code: "holder.partial", severity: "warning" });
  }

  // Cross-border payout outside the residence country: allowed, but reviewed.
  if (iban.valid && input.residence_country) {
    const residence = input.residence_country.toUpperCase();
    if (residence.length === 2 && residence !== iban.country) {
      issues.push({ field: "bank_iban", code: "bank.crossBorder", severity: "warning" });
    }
    if (!iban.sepa) {
      issues.push({ field: "bank_iban", code: "bank.nonSepa", severity: "warning" });
    }
  }

  const hasError = issues.some((i) => i.severity === "error");
  return {
    issues,
    valid: !hasError,
    requiresReview: !hasError && issues.some((i) => i.severity === "warning"),
  };
}
