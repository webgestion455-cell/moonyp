import { readFileSync } from "node:fs";

const languages = [
  "en",
  "fr",
  "de",
  "bg",
  "el",
  "es",
  "it",
  "nl",
  "fi",
  "pl",
  "ro",
  "hr",
  "hu",
  "sk",
  "sl",
];
const keys = [
  "passed",
  "failed",
  "manual_review",
  "reviewNotice",
  "checking",
  "checkingDesc",
  "passedNotice",
  "failedNotice",
  "retry",
  "unavailable",
  "unavailableNotice",
];
const read = (lang) =>
  JSON.parse(readFileSync(new URL(`../src/i18n/locales/${lang}.json`, import.meta.url), "utf8")).kyc
    .decision;
const english = read("en");
let errors = 0;
for (const lang of languages) {
  const messages = read(lang);
  for (const key of keys) {
    if (
      typeof messages[key] !== "string" ||
      !messages[key].trim() ||
      (lang !== "en" && messages[key] === english[key])
    ) {
      console.error(`${lang}: ${key} absent ou copie anglaise`);
      errors++;
    }
  }
}
console.log(
  `Décisions KYC : ${languages.length} langues, ${errors} anomalie(s). Ce contrôle ne remplace pas une relecture linguistique.`,
);
process.exitCode = errors ? 1 : 0;
