/**
 * Remise à niveau des dictionnaires documentaires `src/lib/pdf/i18n/*.json`.
 *
 * Deux corrections, indispensables avant toute génération de PDF contractuel :
 *
 *  1. `labels.article` — la clé manquait dans six dictionnaires (en, fr, de,
 *     es, it, nl). Les documents affichaient alors « Article 1 » reconstruit
 *     par le repli de `doc-i18n.server.ts` : on inscrit ici le vrai libellé.
 *  2. `enums.*` — le bloc a bien été injecté dans les quinze langues par
 *     `pdf-enums-apply.mjs`, mais les treize langues autres que le français
 *     ont conservé la valeur anglaise. Toute valeur encore strictement
 *     identique à l'anglais est retraduite.
 *
 *   bun scripts/pdf-i18n-repair.mjs
 *   bun scripts/pdf-i18n-repair.mjs --dry    # simple diagnostic, aucun écrit
 */
import { readFileSync, writeFileSync } from "node:fs";
import { translateMapAsync } from "./lib/translate.mjs";

const DIR = "src/lib/pdf/i18n";
const LANGS = ["fr", "en", "de", "es", "it", "nl", "pl", "ro", "sk", "sl", "hr", "hu", "fi", "bg", "el"];
const DRY = process.argv.includes("--dry");

/** Libellé « Article » : terme juridique figé, jamais traduit automatiquement. */
const ARTICLE = {
  en: "Article",
  fr: "Article",
  de: "Artikel",
  es: "Artículo",
  it: "Articolo",
  nl: "Artikel",
  pl: "Artykuł",
  ro: "Articolul",
  sk: "Článok",
  sl: "Člen",
  hr: "Članak",
  hu: "Cikk",
  fi: "Artikla",
  bg: "Член",
  el: "Άρθρο",
};

function flatten(block, prefix = "") {
  const out = {};
  for (const [key, value] of Object.entries(block ?? {})) {
    if (value && typeof value === "object") Object.assign(out, flatten(value, `${prefix}${key}.`));
    else out[`${prefix}${key}`] = value;
  }
  return out;
}

function setPath(target, path, value) {
  const parts = path.split(".");
  let node = target;
  for (const part of parts.slice(0, -1)) {
    node[part] ??= {};
    node = node[part];
  }
  node[parts[parts.length - 1]] = value;
}

const enBundle = JSON.parse(readFileSync(`${DIR}/en.json`, "utf8"));
const enEnums = flatten(enBundle.enums);

for (const lang of LANGS) {
  const file = `${DIR}/${lang}.json`;
  const bundle = JSON.parse(readFileSync(file, "utf8"));
  let touched = 0;

  /* 1. libellé « Article » ------------------------------------------------ */
  if (!bundle.labels?.article) {
    bundle.labels ??= {};
    bundle.labels.article = ARTICLE[lang] ?? ARTICLE.en;
    touched += 1;
  }

  /* 2. valeurs d'énumération restées en anglais --------------------------- */
  if (lang !== "en" && lang !== "fr") {
    const current = flatten(bundle.enums);
    const todo = {};
    for (const [key, value] of Object.entries(enEnums)) {
      if (!current[key] || current[key] === value) todo[key] = value;
    }
    const count = Object.keys(todo).length;
    if (count > 0) {
      console.log(`${lang}: ${count} libellés d'énumération à traduire…`);
      if (!DRY) {
        const translated = await translateMapAsync(todo, lang, "en", 6);
        for (const [key, value] of Object.entries(translated)) {
          setPath((bundle.enums ??= {}), key, value);
          touched += 1;
        }
      }
    }
  }

  if (DRY) {
    console.log(`${lang}: ${touched} correction(s) détectée(s) [dry-run]`);
    continue;
  }
  writeFileSync(file, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
  console.log(`${lang}: ${touched} correction(s) écrite(s)`);
}
