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
  "mesures client seules → jamais de validation bancaire",
  nominal.decision === "manual_review",
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
  // Une vivacité absente est une preuve manquante, pas une fraude démontrée :
  // elle bloque la validation automatique sans prononcer de refus.
  "sans vivacité → jamais vérifiée, examen manuel",
  noLiveness.decision === "manual_review",
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
  // MRZ illisible : la machine ne peut pas conclure seule, elle passe la main
  // à la conformité. Elle ne prononce pas un refus sur une lecture ratée.
  "objet sans MRZ → jamais vérifié, examen manuel",
  unreadable.decision === "manual_review",
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
    `tentative ${attempt + 1} sans pièce → jamais vérifiée`,
    result.decision !== "passed" && result.reasons.includes("no_identity_document"),
  );
}
check(
  "comparaison faciale non inventée",
  nominal.reasons.includes("identity_face_match_not_performed"),
);

/* ---------------------------------------------------------------------------
 * Correspondance faciale — le cœur de la décision d'identité.
 * ------------------------------------------------------------------------ */

const fullDocuments = [
  {
    document_type_slug: "id_passport",
    category: "identity",
    capture_status: "passed" as const,
    capture_reasons: [] as string[],
    capture_score: 82,
    capture_method: "scan" as const,
    ocr: goodOcr,
  },
  {
    document_type_slug: "selfie_liveness",
    category: "selfie",
    capture_status: "passed" as const,
    capture_reasons: [] as string[],
    capture_score: 90,
    capture_method: "liveness" as const,
  },
];

function faceOutcome(
  similarity: number,
  band: "match" | "borderline" | "mismatch",
  reasons: string[],
) {
  return {
    compared: true,
    similarity,
    threshold: 0.6,
    passed: band === "match",
    reasons,
    band,
    engine: "moonyp-face-classic",
    engine_version: "1.0.0",
    method: "hog+lbp+ncc",
    document_faces: 1,
    live_faces: 1,
    quality: null,
    compared_at: at.toISOString(),
  };
}

const matched = decideKyc({
  declared,
  at,
  documents: fullDocuments,
  faceMatch: faceOutcome(0.72, "match", ["identity_face_match_passed"]),
});
check(
  "visage correspondant + contrôles obligatoires → identité vérifiée",
  matched.decision === "passed" && matched.reasons.includes("identity_face_match_passed"),
  matched.reasons,
);
check(
  "récapitulatif client cohérent avec la décision",
  matched.checklist.find((i) => i.key === "face_match")?.status === "passed" &&
    matched.checklist.find((i) => i.key === "liveness")?.status === "passed",
  matched.checklist,
);

const borderline = decideKyc({
  declared,
  at,
  documents: fullDocuments,
  faceMatch: faceOutcome(0.5, "borderline", ["identity_face_match_borderline"]),
});
check(
  "similarité intermédiaire → examen manuel, jamais validation",
  borderline.decision === "manual_review",
  borderline.reasons,
);

const mismatched = decideKyc({
  declared,
  at,
  documents: fullDocuments,
  faceMatch: faceOutcome(0.21, "mismatch", ["identity_face_match_failed"]),
});
check(
  "visages clairement différents → refus",
  mismatched.decision === "failed" && mismatched.reasons.includes("identity_face_match_failed"),
  mismatched.reasons,
);

const twoFaces = decideKyc({
  declared,
  at,
  documents: fullDocuments,
  faceMatch: {
    ...faceOutcome(0, "not_compared" as never, ["multiple_faces_on_live_capture"]),
    compared: false,
    passed: false,
    live_faces: 2,
    similarity: null,
  },
});
check(
  "plusieurs visages sur la vivacité → refus",
  twoFaces.decision === "failed",
  twoFaces.reasons,
);

check(
  "vivacité réussie seule ne vaut jamais identité vérifiée",
  nominal.decision !== "passed" && nominal.reasons.includes("liveness_passed"),
  nominal.reasons,
);
check(
  "seuils serveur joints à la décision",
  typeof matched.thresholds.version === "string" &&
    matched.thresholds.face_match > 0 &&
    matched.thresholds.liveness > 0,
  matched.thresholds,
);
console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
process.exit(failed === 0 ? 0 : 1);
