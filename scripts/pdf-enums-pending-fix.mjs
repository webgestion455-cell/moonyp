/**
 * Corrige le libellé `enums.common.pending_assignment` des 15 dictionnaires
 * documentaires (src/lib/pdf/i18n/*.json).
 *
 * Ce libellé s'imprime sur la notice d'assurance quand le numéro de police
 * n'est pas encore attribué. Les valeurs ci-dessous sont rédigées à la main
 * (formulation contractuelle), la traduction automatique produisait des
 * tournures fautives (« Zugeteilt werden », « Ollaan määrättynä »…).
 *
 *   node scripts/pdf-enums-pending-fix.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "src/lib/pdf/i18n");

/** Libellé « numéro en cours d'attribution », rédigé langue par langue. */
const PENDING_ASSIGNMENT = {
  fr: "En cours d'attribution",
  en: "Pending assignment",
  de: "Wird noch zugeteilt",
  es: "Pendiente de asignación",
  it: "In corso di attribuzione",
  nl: "Wordt nog toegekend",
  pl: "W trakcie nadawania",
  ro: "În curs de atribuire",
  sk: "Prideľuje sa",
  sl: "V postopku dodelitve",
  hr: "U postupku dodjele",
  hu: "Kiadása folyamatban",
  fi: "Myönnetään parhaillaan",
  bg: "Предстои да бъде определен",
  el: "Υπό απόδοση",
};

/** Libellés partagés indispensables au repli des documents. */
const COMMON_EXTRA = {
  fr: { not_applicable: "Sans objet" },
  en: { not_applicable: "Not applicable" },
  de: { not_applicable: "Nicht zutreffend" },
  es: { not_applicable: "No aplicable" },
  it: { not_applicable: "Non applicabile" },
  nl: { not_applicable: "Niet van toepassing" },
  pl: { not_applicable: "Nie dotyczy" },
  ro: { not_applicable: "Nu se aplică" },
  sk: { not_applicable: "Neuplatňuje sa" },
  sl: { not_applicable: "Ni relevantno" },
  hr: { not_applicable: "Nije primjenjivo" },
  hu: { not_applicable: "Nem alkalmazandó" },
  fi: { not_applicable: "Ei sovellettavissa" },
  bg: { not_applicable: "Не се прилага" },
  el: { not_applicable: "Δεν εφαρμόζεται" },
};

let changed = 0;
for (const [lang, value] of Object.entries(PENDING_ASSIGNMENT)) {
  const file = join(DIR, `${lang}.json`);
  const json = JSON.parse(readFileSync(file, "utf8"));
  json.enums = json.enums ?? {};
  json.enums.common = {
    ...(json.enums.common ?? {}),
    ...COMMON_EXTRA[lang],
    pending_assignment: value,
  };
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`, "utf8");
  changed += 1;
  console.log(`${lang}: ${value}`);
}
console.log(`\n${changed} dictionnaires documentaires mis à jour.`);
