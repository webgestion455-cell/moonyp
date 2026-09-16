/**
 * Ajoute les libellés du nouveau parcours KYC (lecture du document, décision
 * d'identité) dans TOUTES les langues du site.
 *
 * Le français et l'anglais reçoivent leur texte définitif ; les autres langues
 * reçoivent le texte anglais, qui reste lisible pour l'utilisateur en
 * attendant la traduction. Aucune clé existante n'est jamais écrasée : le
 * script est idempotent, vous pouvez le relancer sans risque.
 *
 *   bun run scripts/kyc-i18n-sync.ts
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const LOCALES_DIR = join(process.cwd(), "src", "i18n", "locales");

type Tree = Record<string, unknown>;

const EN = {
  reading: {
    title: "Reading your document",
    desc: "We are reading the machine-readable zone on your device. The image does not leave your phone for this step.",
  },
  decision: {
    passed: "Identity verified",
    manual_review: "Identity under review",
    failed: "Identity could not be verified",
    reviewNotice:
      "Our compliance team is finishing the checks. You will be notified as soon as the decision is made.",
  },
  guard: {
    fullscreen: "Stay on this screen until the step is complete.",
  },
};

const FR = {
  reading: {
    title: "Lecture de votre document",
    desc: "Nous lisons la bande de lecture automatique sur votre appareil. L'image ne quitte pas votre téléphone pour cette étape.",
  },
  decision: {
    passed: "Identité vérifiée",
    manual_review: "Identité en cours d'examen",
    failed: "Identité non vérifiée",
    reviewNotice:
      "Notre équipe conformité termine les contrôles. Vous serez prévenu dès que la décision est prise.",
  },
  guard: {
    fullscreen: "Restez sur cet écran jusqu'à la fin de l'étape.",
  },
};

/** Fusion non destructive : une clé déjà traduite n'est jamais remplacée. */
function mergeMissing(target: Tree, source: Tree): number {
  let added = 0;
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const existing = target[key];
      const branch: Tree =
        existing && typeof existing === "object" && !Array.isArray(existing)
          ? (existing as Tree)
          : {};
      added += mergeMissing(branch, value as Tree);
      target[key] = branch;
    } else if (!(key in target)) {
      target[key] = value;
      added += 1;
    }
  }
  return added;
}

const files = readdirSync(LOCALES_DIR).filter((f) => f.endsWith(".json"));
let total = 0;

for (const file of files) {
  const path = join(LOCALES_DIR, file);
  const json = JSON.parse(readFileSync(path, "utf8")) as Tree;
  const kyc = (json["kyc"] && typeof json["kyc"] === "object" ? json["kyc"] : {}) as Tree;

  const source = file === "fr.json" ? FR : EN;
  const added = mergeMissing(kyc, source as unknown as Tree);
  json["kyc"] = kyc;

  if (added > 0) {
    writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`, "utf8");
    total += added;
  }
  console.log(`${file.padEnd(12)} ${added} clé(s) ajoutée(s)`);
}

console.log(`\n${total} clé(s) ajoutée(s) au total sur ${files.length} langue(s).`);
