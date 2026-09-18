#!/usr/bin/env bun
/**
 * Application des libellés KYC (scanner, vivacité, « importer ou scanner »)
 * dans les 15 langues — exécuter avec `bun scripts/kyc-i18n-apply.mjs`.
 *
 * Le script est idempotent :
 *  1. il fusionne, langue par langue, les textes rédigés nativement dans
 *     scripts/data/kyc-i18n.*.json (aucune traduction mécanique commune) ;
 *  2. il retire les clés devenues obsolètes avec l'ancien écran « Capturer »,
 *     de façon identique dans toutes les langues (parité des clés préservée) ;
 *  3. il réécrit chaque fichier de langue trié, en UTF-8, avec un retour à la
 *     ligne final.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES_DIR = join(ROOT, "src/i18n/locales");
const DATA_DIR = join(ROOT, "scripts/data");

/** Clés supprimées avec l'écran « Capturer » (chemins relatifs à `kyc`). */
const OBSOLETE = [
  "capture",
  "camera.ready",
  "camera.start",
  "camera.shoot",
  "camera.retake",
  "camera.use",
  "camera.importInstead",
  "camera.denied",
  "camera.unsupported",
  "camera.quality",
];

const setPath = (obj, path, value) => {
  const parts = path.split(".");
  let node = obj;
  for (const part of parts.slice(0, -1)) {
    if (!node[part] || typeof node[part] !== "object") node[part] = {};
    node = node[part];
  }
  node[parts.at(-1)] = value;
};

const deletePath = (obj, path) => {
  const parts = path.split(".");
  let node = obj;
  for (const part of parts.slice(0, -1)) {
    node = node?.[part];
    if (!node || typeof node !== "object") return;
  }
  delete node[parts.at(-1)];
};

const sortDeep = (value) => {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort((a, b) => a.localeCompare(b, "en"))
        .map((k) => [k, sortDeep(value[k])]),
    );
  }
  return value;
};

const translations = {};
for (const file of readdirSync(DATA_DIR).filter(
  (f) => f.startsWith("kyc-i18n.") && f.endsWith(".json"),
)) {
  const part = JSON.parse(readFileSync(join(DATA_DIR, file), "utf8"));
  for (const [lang, entries] of Object.entries(part)) {
    translations[lang] = { ...(translations[lang] ?? {}), ...entries };
  }
}

const localeFiles = readdirSync(LOCALES_DIR).filter((f) => f.endsWith(".json"));
const missing = localeFiles
  .map((f) => f.replace(/\.json$/, ""))
  .filter((lang) => !translations[lang]);
if (missing.length > 0) {
  console.error(`Langues sans contenu KYC rédigé : ${missing.join(", ")}`);
  process.exit(1);
}

let changed = 0;
for (const file of localeFiles) {
  const lang = file.replace(/\.json$/, "");
  const path = join(LOCALES_DIR, file);
  const before = readFileSync(path, "utf8");
  const json = JSON.parse(before);
  json.kyc ??= {};

  for (const [key, value] of Object.entries(translations[lang])) setPath(json.kyc, key, value);
  for (const key of OBSOLETE) deletePath(json.kyc, key);

  const after = `${JSON.stringify(sortDeep(json), null, 2)}\n`;
  if (after !== before) {
    writeFileSync(path, after, "utf8");
    changed += 1;
  }
  console.log(`${lang} : ${Object.keys(translations[lang]).length} libellés KYC appliqués`);
}

console.log(`\n${changed} fichier(s) de langue mis à jour sur ${localeFiles.length}.`);
