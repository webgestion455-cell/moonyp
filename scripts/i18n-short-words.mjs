/**
 * Deuxième passe de résorption de l'anglais résiduel : les MOTS COURTS.
 *
 * `i18n-repair-residual.mjs` laisse volontairement de côté les valeurs d'un
 * seul mot de moins de douze caractères (« Status », « Cancel », « Details »,
 * « Password »…). Or ces mots apparaissent dans les statuts de dossier, les
 * boutons des e-mails et le suivi client : ils doivent eux aussi être dans la
 * langue du destinataire.
 *
 * Ce script ne traduit QUE ces mots courts, en excluant strictement :
 *   - le vocabulaire bancaire international (IBAN, BIC, SWIFT, SEPA) ;
 *   - les noms propres, marques, adresses postales et liens ;
 *   - les sigles réglementaires (AML / KYC, eIDAS, RGPD/GDPR).
 *
 * Si le moteur renvoie exactement le mot anglais, la valeur est conservée :
 * cela signifie simplement que le mot est identique dans la langue cible.
 *
 *   bun scripts/i18n-short-words.mjs
 *   bun scripts/i18n-short-words.mjs --dry
 */
import { readFileSync, writeFileSync } from "node:fs";
import { translateMapAsync } from "./lib/translate.mjs";

const DIR = "src/i18n/locales";
const TARGETS = ["de", "es", "it", "nl", "pl", "ro", "sk", "sl", "hr", "hu", "fi", "bg", "el"];
const DRY = process.argv.includes("--dry");

/** Clés jamais traduites : coordonnées, marque, identifiants bancaires. */
const KEY_DENYLIST = [
  /\.bic$/i,
  /\.iban$/i,
  /^contact\.address/,
  /^chat\.banner\./,
  /^receipt\.subBrand$/,
  /^receipt\.serverBic$/,
  /^landing\.testi\.t\d+n$/,
  /^legal\.mentions\.sections\.[23]\.(p|h)$/,
  /^chat\.guest\.whatsapp$/,
  /^footer\.aml$/,
];

/** Termes conservés tels quels dans toutes les langues. */
const KEEP = new Set(
  [
    "iban",
    "bic",
    "bic / swift",
    "swift",
    "sepa",
    "whatsapp",
    "moonyp",
    "aml / kyc",
    "kyc",
    "eidas",
    "gdpr",
    "rgpd",
    "email",
    "e-mail",
    "sms",
    "pdf",
    "qr code",
  ].map((v) => v.toLowerCase()),
);

const flatten = (block, prefix = "") =>
  Object.entries(block ?? {}).reduce((acc, [key, value]) => {
    if (value && typeof value === "object") Object.assign(acc, flatten(value, `${prefix}${key}.`));
    else acc[`${prefix}${key}`] = value;
    return acc;
  }, {});

function setPath(target, path, value) {
  const parts = path.split(".");
  let node = target;
  for (const part of parts.slice(0, -1)) {
    node[part] ??= {};
    node = node[part];
  }
  node[parts[parts.length - 1]] = value;
}

/** Un mot court, alphabétique, sans balise ni interpolation. */
function isShortWord(value) {
  const v = value.trim();
  if (!v || v.includes(" ")) return false;
  if (v.length > 12) return false;
  if (!/^[A-Za-z]{3,}$/.test(v)) return false;
  if (KEEP.has(v.toLowerCase())) return false;
  return true;
}

const en = flatten(JSON.parse(readFileSync(`${DIR}/en.json`, "utf8")));

for (const lang of TARGETS) {
  const file = `${DIR}/${lang}.json`;
  const bundle = JSON.parse(readFileSync(file, "utf8"));
  const current = flatten(bundle);

  const todo = {};
  for (const [key, value] of Object.entries(en)) {
    if (typeof value !== "string" || typeof current[key] !== "string") continue;
    if (current[key] !== value) continue;
    if (KEY_DENYLIST.some((re) => re.test(key))) continue;
    if (!isShortWord(value)) continue;
    todo[key] = value;
  }

  const count = Object.keys(todo).length;
  if (count === 0) {
    console.log(`${lang}: aucun mot court à traduire`);
    continue;
  }
  if (DRY) {
    console.log(`${lang}: ${count} mot(s) court(s) [dry-run]`);
    continue;
  }

  console.log(`${lang}: traduction de ${count} mot(s) court(s)…`);
  const translated = await translateMapAsync(todo, lang, "en", 6);
  let written = 0;
  for (const [key, value] of Object.entries(translated)) {
    const clean = String(value).trim();
    if (!clean) continue;
    setPath(bundle, key, clean);
    if (clean !== todo[key]) written += 1;
  }
  writeFileSync(file, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
  console.log(`${lang}: ${written} mot(s) réellement traduit(s)`);
}
