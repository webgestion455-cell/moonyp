/**
 * Synchronise l'adresse du siège dans les 15 langues de l'interface et des
 * PDF, à partir de la source unique `src/lib/brand-address.ts`.
 *
 * Exécution locale depuis le terminal du projet :
 *
 *   bun run scripts/brand-address-sync.ts            # applique
 *   bun run scripts/brand-address-sync.ts --check    # vérifie sans écrire
 *
 * Règles appliquées :
 *   - la voie et la ville ne sont jamais traduites (« 1 Centenary Square,
 *     Birmingham, B1 2DR ») — majuscule corrigée partout ;
 *   - le nom du pays est rendu dans la langue du fichier (Royaume-Uni,
 *     Vereinigtes Königreich, Regno Unito…) ;
 *   - les anciennes adresses résiduelles (Paris) sont remplacées.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BRAND_ADDRESS, brandAddressLines, formatBrandAddress } from "../src/lib/brand-address";

const LANGS = ["en", "fr", "de", "es", "it", "nl", "pl", "ro", "hu", "fi", "bg", "el", "hr", "sk", "sl"];
const CHECK = process.argv.includes("--check");
const ROOT = resolve(import.meta.dirname ?? ".", "..");

type Json = Record<string, unknown>;

let changedFiles = 0;
let problems = 0;

function load(path: string): Json {
  return JSON.parse(readFileSync(path, "utf8")) as Json;
}

function save(path: string, data: Json, before: string) {
  const after = `${JSON.stringify(data, null, 2)}\n`;
  if (after === before) return;
  changedFiles += 1;
  if (CHECK) {
    problems += 1;
    console.log(`  à mettre à jour : ${path.replace(`${ROOT}/`, "")}`);
    return;
  }
  writeFileSync(path, after);
  console.log(`  écrit : ${path.replace(`${ROOT}/`, "")}`);
}

/** Toute écriture (ancienne ou nouvelle) de l'adresse, pays compris ou non. */
const ADDRESS_RE =
  /1 [Cc]entenary Square,\s*Birmingham(?:,\s*B1 2DR)?(?:,\s*[^.;·—]+?)?(?=(?:\.\s|\.$|$|·|—|;|\n|"))/g;

for (const lang of LANGS) {
  const lines = brandAddressLines(lang);
  const full = formatBrandAddress(lang);

  /* ---------------------------- Interface ------------------------------ */
  const uiPath = resolve(ROOT, `src/i18n/locales/${lang}.json`);
  const uiRaw = readFileSync(uiPath, "utf8");
  const ui = load(uiPath);

  const contact = (ui["contact"] ??= {}) as Json;
  contact["address"] = lines.street;
  contact["addressCity"] = `${lines.locality}, ${lines.country}`;

  const chat = ui["chat"] as Json | undefined;
  const banner = chat?.["banner"] as Json | undefined;
  if (banner && typeof banner["bottom"] === "string") {
    banner["bottom"] = (banner["bottom"] as string).replace(
      /1 [Cc]entenary Square, Birmingham, B1 2DR/,
      `${BRAND_ADDRESS.street}, ${BRAND_ADDRESS.city}, ${BRAND_ADDRESS.postcode}`,
    );
  }

  const legal = ui["legal"] as Json | undefined;
  const mentions = legal?.["mentions"] as Json | undefined;
  const sections = mentions?.["sections"] as Json[] | undefined;
  if (sections) {
    for (const section of sections) {
      if (typeof section["p"] !== "string") continue;
      section["p"] = (section["p"] as string).replace(ADDRESS_RE, full);
    }
  }
  if (lang === "fr") {
    const aml = legal?.["amlKyc"] as Json | undefined;
    for (const section of (aml?.["sections"] as Json[] | undefined) ?? []) {
      if (typeof section["p"] === "string") {
        section["p"] = (section["p"] as string).replace("OFAC et United Kingdom", "OFAC et Royaume-Uni");
      }
    }
  }
  save(uiPath, ui, uiRaw);

  /* ------------------------------- PDF --------------------------------- */
  const pdfPath = resolve(ROOT, `src/lib/pdf/i18n/${lang}.json`);
  const pdfRaw = readFileSync(pdfPath, "utf8");
  const pdf = load(pdfPath);
  const contract = pdf["contract"] as Json | undefined;
  for (const section of Object.values(pdf)) {
    if (!section || typeof section !== "object") continue;
    const s = section as Json;
    if (typeof s["sigPlace"] === "string" && /Birmingham/.test(s["sigPlace"] as string)) {
      s["sigPlace"] = `${BRAND_ADDRESS.city}, ${lines.country}`;
    }
  }
  void contract;
  save(pdfPath, pdf, pdfRaw);
}

console.log(
  CHECK
    ? changedFiles === 0
      ? "\nAdresse du siège : tous les fichiers sont à jour."
      : `\n${changedFiles} fichier(s) à synchroniser — lancez sans --check.`
    : `\nAdresse du siège synchronisée (${changedFiles} fichier(s) modifié(s)).`,
);
process.exit(CHECK && problems > 0 ? 1 : 0);
