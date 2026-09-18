import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd(), "src/lib/pdf/i18n");
const expectedLanguages = [
  "fr",
  "en",
  "de",
  "es",
  "it",
  "nl",
  "pl",
  "ro",
  "sk",
  "sl",
  "hr",
  "hu",
  "fi",
  "bg",
  "el",
];
const legalInvariants = ["MOONYP", "910/2014", "SHA-256"];

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

function flatten(value: Json, prefix = ""): Map<string, string> {
  const result = new Map<string, string>();
  if (typeof value === "string") result.set(prefix, value);
  else if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      for (const [path, text] of flatten(child, prefix ? `${prefix}.${key}` : key))
        result.set(path, text);
    }
  }
  return result;
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)].map((match) => match[1]!).sort();
}

const files = readdirSync(root)
  .filter((name) => name.endsWith(".json"))
  .sort();
const presentLanguages = files.map((name) => name.replace(/\.json$/, ""));
const errors: string[] = [];
for (const language of expectedLanguages) {
  if (!presentLanguages.includes(language)) errors.push(`Dictionnaire manquant : ${language}.json`);
}
for (const language of presentLanguages) {
  if (!expectedLanguages.includes(language))
    errors.push(`Dictionnaire inattendu : ${language}.json`);
}

const reference = flatten(JSON.parse(readFileSync(join(root, "en.json"), "utf8")) as Json);
for (const language of expectedLanguages) {
  const path = join(root, `${language}.json`);
  let current: Map<string, string>;
  try {
    current = flatten(JSON.parse(readFileSync(path, "utf8")) as Json);
  } catch (error) {
    errors.push(`${language}.json : JSON invalide (${String(error)})`);
    continue;
  }
  for (const [key, english] of reference) {
    const translated = current.get(key);
    if (translated === undefined) errors.push(`${language}.json : clé manquante ${key}`);
    else {
      if (translated.trim() === "") errors.push(`${language}.json : valeur vide ${key}`);
      if (placeholders(translated).join("|") !== placeholders(english).join("|")) {
        errors.push(`${language}.json : placeholders incompatibles ${key}`);
      }
      for (const invariant of legalInvariants) {
        if (english.includes(invariant) && !translated.includes(invariant)) {
          errors.push(`${language}.json : invariant « ${invariant} » absent de ${key}`);
        }
      }
    }
  }
  for (const key of current.keys())
    if (!reference.has(key)) errors.push(`${language}.json : clé inattendue ${key}`);
}

if (errors.length) {
  console.error(`Audit i18n PDF échoué (${errors.length} anomalie(s)) :\n- ${errors.join("\n- ")}`);
  process.exit(1);
}
console.log(
  `Audit i18n PDF réussi : ${expectedLanguages.length} langues, ${reference.size} clés par dictionnaire.`,
);
