/**
 * Auto-test du moteur KYC : lecture MRZ, croisement d'identité, décision.
 *
 * Exécution locale depuis le terminal du projet :
 *
 *   bun run scripts/kyc-selftest.ts
 *
 * Aucune base de données, aucun réseau, aucune caméra : ce script vérifie la
 * logique de décision pure. Il doit rester vert avant toute mise en ligne
 * touchant au parcours d'identité.
 */

import { parseMrz, mrzCheckDigit } from "../src/lib/kyc/mrz";
import { crossCheckIdentity } from "../src/lib/kyc/identity-match";
import { decideKyc } from "../src/lib/kyc/decision.server";

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${name}`, detail ?? "");
  }
}

/* --------------------------- 1. Clés de contrôle ------------------------- */
console.log("\nClés de contrôle OACI 9303");
check("séquence numérique", mrzCheckDigit("123456789") === 7);
check("chevrons ignorés comme zéro", mrzCheckDigit("<<<") === 0);

/* ------------------------------- 2. MRZ TD3 ------------------------------ */
// Passeport spécimen utilisé par la documentation OACI.
const TD3 = [
  "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<",
  "L898902C36UTO7408122F1204159ZE184226B<<<<<10",
];

console.log("\nLecture MRZ (passeport TD3)");
const mrz = parseMrz(TD3.join("\n"));
check("MRZ reconnue", mrz !== null);
check("format TD3", mrz?.format === "TD3", mrz?.format);
check("nom lu", mrz?.surname === "ERIKSSON", mrz?.surname);
check("prénoms lus", mrz?.given_names === "ANNA MARIA", mrz?.given_names);
check("date de naissance 1974-08-12", mrz?.birth_date === "1974-08-12", mrz?.birth_date);
check("expiration 2012-04-15", mrz?.expiry_date === "2012-04-15", mrz?.expiry_date);
check("nationalité UTO", mrz?.nationality === "UTO", mrz?.nationality);

/* -------------------------- 3. Croisement identité ----------------------- */
console.log("\nCroisement des données déclarées");
const declared = {
  first_name: "Anna",
  last_name: "Eriksson",
  birth_date: "1974-08-12",
  nationality: "UT",
};
const at = new Date("2010-01-01T00:00:00Z");
const match = mrz ? crossCheckIdentity(declared, mrz, { at }) : null;
check("identité concordante", (match?.score ?? 0) >= 90, match?.score);
check(
  "aucun écart bloquant",
  !(match?.reasons ?? []).includes("birth_date_mismatch"),
  match?.reasons,
);

const wrongBirth = mrz
  ? crossCheckIdentity({ ...declared, birth_date: "1980-01-01" }, mrz, { at })
  : null;
check(
  "date de naissance divergente détectée",
  (wrongBirth?.reasons ?? []).includes("birth_date_mismatch"),
);

const wrongName = mrz
  ? crossCheckIdentity({ ...declared, last_name: "Dupont" }, mrz, { at })
  : null;
check("nom divergent détecté", (wrongName?.reasons ?? []).includes("surname_mismatch"));

const expired = mrz ? crossCheckIdentity(declared, mrz, { at: new Date("2024-01-01") }) : null;
check("document expiré détecté", expired?.document_expired === true);

/* ----------------------------- 4. Décisions ------------------------------ */
console.log("\nDécision finale");

const goodOcr = {
  mrz_text: TD3.join("\n"),
  viz_text: "",
  confidence: 88,
  engine: { name: "tesseract", version: "5" },
};

const nominal = decideKyc({
  declared,
  at,
  documents: [
    {
      document_type_slug: "id_passport",
      category: "identity",
      capture_status: "passed",
      capture_reasons: [],
      capture_score: 82,
      capture_method: "scan",
      ocr: goodOcr,
    },
    {
      document_type_slug: "selfie_liveness",
      category: "selfie",
      capture_status: "passed",
      capture_reasons: [],
      capture_score: 90,
      capture_method: "liveness",
    },
  ],
});
check(
  "preuves concordantes → validation automatique",
  nominal.decision === "passed",
  nominal,
);

const noLiveness = decideKyc({
  declared,
  at,
  documents: [
    {
      document_type_slug: "id_passport",
      category: "identity",
      capture_status: "passed",
      capture_reasons: [],
      capture_score: 82,
      capture_method: "scan",
      ocr: goodOcr,
    },
  ],
});
check(
  "sans vivacité → vérification non aboutie",
  noLiveness.decision === "failed",
  noLiveness.reasons,
);

const mismatch = decideKyc({
  declared: { ...declared, birth_date: "1980-01-01" },
  at,
  documents: [
    {
      document_type_slug: "id_passport",
      category: "identity",
      capture_status: "passed",
      capture_reasons: [],
      capture_score: 82,
      capture_method: "scan",
      ocr: goodOcr,
    },
    {
      document_type_slug: "selfie_liveness",
      category: "selfie",
      capture_status: "passed",
      capture_reasons: [],
      capture_score: 90,
      capture_method: "liveness",
    },
  ],
});
check("date de naissance divergente → échec", mismatch.decision === "failed", mismatch.reasons);

const screen = decideKyc({
  declared,
  at,
  documents: [
    {
      document_type_slug: "id_passport",
      category: "identity",
      capture_status: "manual_review",
      capture_reasons: ["screen_presentation_suspected"],
      capture_score: 70,
      capture_method: "scan",
      ocr: goodOcr,
    },
    {
      document_type_slug: "selfie_liveness",
      category: "selfie",
      capture_status: "passed",
      capture_reasons: [],
      capture_score: 90,
      capture_method: "liveness",
    },
  ],
});
check("photo d'écran → jamais validée", screen.decision !== "passed", screen.reasons);

const unreadable = decideKyc({
  declared,
  at,
  documents: [
    {
      document_type_slug: "id_card",
      category: "identity",
      capture_status: "passed",
      capture_reasons: [],
      capture_score: 80,
      capture_method: "scan",
      ocr: { mrz_text: "illisible", viz_text: "", confidence: 20 },
    },
    {
      document_type_slug: "selfie_liveness",
      category: "selfie",
      capture_status: "passed",
      capture_reasons: [],
      capture_score: 90,
      capture_method: "liveness",
    },
  ],
});
check(
  "objet sans MRZ → vérification non aboutie",
  unreadable.decision === "failed",
  unreadable.reasons,
);
check("aucune ligne MRZ en clair conservée", unreadable.mrz === null);

const masked = nominal.mrz?.lines_masked ?? [];
check(
  "lignes MRZ masquées en base",
  masked.every((l) => l.includes("•")),
  masked,
);

for (let attempt = 0; attempt < 3; attempt += 1) {
  const result = decideKyc({ declared, at, documents: [] });
  check(
    `tentative ${attempt + 1} sans pièce → toujours non vérifiée`,
    result.decision === "failed",
  );
}
check("comparaison faciale non inventée", nominal.reasons.includes("face_match_not_performed"));
check(
  "contrôle adresse non inventé",
  nominal.reasons.includes("address_verification_not_performed"),
);
check(
  "contrôle bancaire non inventé",
  nominal.reasons.includes("bank_statement_verification_not_performed"),
);
console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
process.exit(failed === 0 ? 0 : 1);
