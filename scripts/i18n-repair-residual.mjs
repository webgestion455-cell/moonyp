/**
 * Résorption de l'anglais résiduel dans `src/i18n/locales/*.json`.
 *
 * Les quinze dictionnaires possèdent les mêmes clés, mais plusieurs centaines
 * de valeurs sont restées strictement identiques à l'anglais — surtout
 * `emails.*` et `workflow.*`, c'est-à-dire précisément ce que le client reçoit
 * par courriel. Ce script retraduit ces valeurs, et uniquement celles-là.
 *
 * Règles de sécurité (aucune régression possible) :
 *   - seules les valeurs *identiques* à l'anglais sont candidates ;
 *   - les termes bancaires internationaux (IBAN, BIC / SWIFT, SEPA), les noms
 *     propres, adresses postales, liens HTML et mentions de marque sont exclus ;
 *   - les mots isolés courts (Contact, Menu, Admin…) sont laissés tels quels :
 *     ils sont corrects dans la plupart des langues ciblées ;
 *   - les interpolations `{{variable}}` sont protégées par `lib/translate.mjs` ;
 *   - le français est exclu : c'est la langue de référence du dossier.
 *
 *   bun scripts/i18n-repair-residual.mjs
 *   bun scripts/i18n-repair-residual.mjs --dry
 */
import { readFileSync, writeFileSync } from "node:fs";
import { translateMapAsync } from "./lib/translate.mjs";

const DIR = "src/i18n/locales";
const TARGETS = ["de", "es", "it", "nl", "pl", "ro", "sk", "sl", "hr", "hu", "fi", "bg", "el"];
const DRY = process.argv.includes("--dry");

/** Clés à ne jamais traduire : identifiants bancaires, marque, coordonnées. */
const KEY_DENYLIST = [
  /\.bic$/i,
  /\.iban$/i,
  /^contact\.address/,
  /^chat\.banner\./,
  /^receipt\.subBrand$/,
  /^landing\.testi\.t\d+n$/,
  /^legal\.mentions\.sections\.[23]\.p$/,
];

/** Valeurs à ne jamais traduire : balises, liens, symboles, sigles. */
function valueDenied(value) {
  if (!/[A-Za-z]{3}/.test(value)) return true;
  if (/<[a-z/]|https?:|mailto:|©/i.test(value)) return true;
  // Mot isolé et court : déjà compréhensible ou identique dans la langue cible.
  if (!value.includes(" ") && value.length <= 12) return true;
  if (/^(IBAN|BIC|SEPA|SWIFT|QR code|Moonyp|MOONYP)$/i.test(value.trim())) return true;
  return false;
}

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
    if (valueDenied(value)) continue;
    todo[key] = value;
  }

  const count = Object.keys(todo).length;
  if (count === 0) {
    console.log(`${lang}: déjà complet`);
    continue;
  }
  if (DRY) {
    console.log(`${lang}: ${count} chaîne(s) à traduire [dry-run]`);
    continue;
  }

  console.log(`${lang}: traduction de ${count} chaîne(s)…`);
  const translated = await translateMapAsync(todo, lang, "en", 6);
  for (const [key, value] of Object.entries(translated)) setPath(bundle, key, value);
  writeFileSync(file, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
  console.log(`${lang}: ${count} chaîne(s) écrite(s)`);
}
