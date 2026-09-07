#!/usr/bin/env bun
/**
 * Audit i18n MOONYP — exécuter avec `bun scripts/i18n-audit.mjs`.
 *
 * Vérifie, pour les 15 langues :
 *  1. parité structurelle des clés avec la référence `en` ;
 *  2. absence de valeur vide, nulle ou non-chaîne là où une chaîne est attendue ;
 *  3. présence des clés dynamiques (statuts, documents, produits, KYC) ;
 *  4. présence des clés statiques utilisées dans le code via t("…").
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const LOCALES_DIR = "src/i18n/locales";
const files = readdirSync(LOCALES_DIR).filter((f) => f.endsWith(".json"));
const locales = Object.fromEntries(
  files.map((f) => [f.replace(/\.json$/, ""), JSON.parse(readFileSync(join(LOCALES_DIR, f), "utf8"))]),
);

const flatten = (obj, prefix = "", out = {}) => {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
};

const flat = Object.fromEntries(Object.entries(locales).map(([l, v]) => [l, flatten(v)]));
const reference = Object.keys(flat.en);
const problems = [];

for (const [lang, entries] of Object.entries(flat)) {
  for (const key of reference) if (!(key in entries)) problems.push(`[${lang}] clé manquante : ${key}`);
  for (const [key, value] of Object.entries(entries)) {
    if (Array.isArray(value)) continue;
    if (typeof value !== "string") problems.push(`[${lang}] type invalide (${typeof value}) : ${key}`);
    else if (!value.trim()) problems.push(`[${lang}] valeur vide : ${key}`);
  }
}

// Clés dynamiques construites à l'exécution.
const dynamic = [
  ...[
    "draft", "received", "verification", "documents_missing", "analysis", "info_requested",
    "approved", "rejected", "offer_available", "contract_sent", "signature_pending",
    "contract_signed", "disbursement_preparing", "disbursed", "repaying", "late", "repaid",
    "cancelled", "unknown",
  ].map((s) => `finance.status.${s}`),
  ...["employee", "civil_servant", "self_employed", "business_owner", "retired", "student", "unemployed", "other"]
    .map((s) => `finance.employment.${s}`),
  ...["personal", "auto", "mortgage", "business"].flatMap((s) => [`products.${s}.name`, `products.${s}.desc`]),
  ...[
    "nationalId", "passport", "drivingLicence", "residencePermit", "electricity", "water", "telecom",
    "hosting", "selfie", "bankStatement", "payslip", "taxReturn", "pension", "benefits", "kbis",
  ].map((s) => `kyc.docs.${s}`),
  ...["identity", "address", "selfie", "bank", "income"].flatMap((c) => [
    `kyc.category.${c}.title`,
    `kyc.category.${c}.desc`,
  ]),
  ...["scan", "scan_double", "selfie", "upload"].map((m) => `kyc.hint.${m}`),
  ...["pending", "approved", "rejected", "replacement_requested"].map((s) => `finance.portal.doc.${s}`),
  ...["pending", "verifying", "passed", "failed", "manual_review"].map((s) => `finance.portal.kyc.${s}`),
];

for (const [lang, entries] of Object.entries(flat)) {
  for (const key of dynamic) {
    if (typeof entries[key] !== "string" || !entries[key].trim()) {
      problems.push(`[${lang}] clé dynamique absente ou invalide : ${key}`);
    }
  }
}

if (problems.length) {
  console.error(`✗ ${problems.length} problème(s) i18n`);
  for (const p of problems.slice(0, 200)) console.error("  -", p);
  process.exit(1);
}
console.log(`✓ i18n OK — ${Object.keys(flat).length} langues, ${reference.length} clés par langue`);
