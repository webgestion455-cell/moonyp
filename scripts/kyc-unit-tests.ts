/**
 * Tests unitaires du moteur KYC — exécution réelle, aucune donnée simulée.
 *
 *   bun run scripts/kyc-unit-tests.ts
 *
 * Les entrées sont des valeurs déterministes écrites ici ; les sorties sont
 * celles du code de production (aucun stub, aucun résultat forcé). Les
 * fonctions testées sont pures : taxonomie et garde-fous des statuts,
 * comparaison faciale (distance euclidienne), filtrage sanctions/PEP et
 * lecture des fichiers de listes.
 */

import {
  CONTROL_DEFINITIONS,
  REQUIRED_CONTROLS,
  STEP_ORDER,
  aggregateKyc,
  controlsForStep,
  sanitizeResult,
  stepStatus,
  unverifiable,
  type ControlResult,
} from "../src/lib/kyc/controls";
import {
  compareFaces,
  descriptorDistance,
  FACE_MATCH_THRESHOLDS,
} from "../src/lib/kyc/face-engine.node";
import {
  compareFullNames,
  screenCandidate,
  SCREENING_LIMITS,
  type ScreeningEntry,
} from "../src/lib/kyc/sanctions";
import { normaliseEntry, parseFile, splitCsvLine } from "./kyc-import-screening-list";

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

/* ------------------------- Taxonomie et statuts ------------------------ */

section("Taxonomie des contrôles");
check("26 contrôles définis", CONTROL_DEFINITIONS.length === 26, CONTROL_DEFINITIONS.length);
check("5 étapes séquentielles", STEP_ORDER.length === 5, STEP_ORDER);
check(
  "chaque étape porte au moins un contrôle obligatoire",
  STEP_ORDER.every((s) => controlsForStep(s).some((c) => c.required)),
);
check(
  "aucun contrôle obligatoire n'est déclaré non vérifiable",
  CONTROL_DEFINITIONS.every((c) => !(c.required && c.unverifiable)),
);
check(
  "document_authenticity est non vérifiable avec motif",
  CONTROL_DEFINITIONS.some(
    (c) => c.key === "document_authenticity" && c.unverifiable && Boolean(c.unverifiableReason),
  ),
);
check("face_match est obligatoire", REQUIRED_CONTROLS.includes("face_match"));
check("iban_holder_match est obligatoire", REQUIRED_CONTROLS.includes("iban_holder_match"));

section("Garde-fous de statut");
const fakePass: ControlResult = {
  control: "document_readability",
  status: "PASS",
  executed: false,
  method: "not_executed",
  reasons: [],
};
check(
  "PASS sans exécution est dégradé en INCONCLUSIVE",
  sanitizeResult(fakePass).status === "INCONCLUSIVE",
);
const fakeAuth: ControlResult = {
  control: "document_authenticity",
  status: "PASS",
  executed: true,
  method: "whatever",
  reasons: [],
};
check(
  "document_authenticity ne peut jamais être PASS",
  sanitizeResult(fakeAuth).status === "NOT_VERIFIED",
);
check(
  "unverifiable() ne renvoie jamais PASS",
  unverifiable("document_authenticity").status === "NOT_VERIFIED",
);

section("Statut d'étape");
check("aucun contrôle → NOT_STARTED", stepStatus("identity", []).status === "NOT_STARTED");
const livenessAllPass: ControlResult[] = controlsForStep("liveness").map((c) => ({
  control: c.key,
  status: "PASS",
  executed: true,
  method: "test_real_values",
  reasons: [],
}));
check("vivacité complète → PASS", stepStatus("liveness", livenessAllPass).status === "PASS");
const withoutFaceMatch = livenessAllPass.filter((c) => c.control !== "face_match");
check(
  "vivacité sans face match → INCONCLUSIVE (jamais PASS)",
  stepStatus("liveness", withoutFaceMatch).status === "INCONCLUSIVE",
);
const faceMatchFail = livenessAllPass.map((c) =>
  c.control === "face_match"
    ? { ...c, status: "FAIL" as const, reasons: ["distance_above_mismatch_threshold"] }
    : c,
);
check("un FAIL prime sur tout", stepStatus("liveness", faceMatchFail).status === "FAIL");
const faceMatchReview = livenessAllPass.map((c) =>
  c.control === "face_match" ? { ...c, status: "REVIEW_REQUIRED" as const } : c,
);
check(
  "REVIEW_REQUIRED prime sur PASS",
  stepStatus("liveness", faceMatchReview).status === "REVIEW_REQUIRED",
);
const identityWithoutAuth: ControlResult[] = controlsForStep("identity")
  .filter((c) => !c.unverifiable)
  .map((c) => ({
    control: c.key,
    status: "PASS",
    executed: true,
    method: "test_real_values",
    reasons: [],
  }));
check(
  "un contrôle facultatif non vérifié ne bloque pas l'étape",
  stepStatus("identity", [...identityWithoutAuth, unverifiable("document_authenticity")]).status ===
    "PASS",
);

section("Agrégat du dossier");
check(
  "aucune étape → kyc_not_started",
  aggregateKyc({ steps: {}, requiredSteps: STEP_ORDER }).state === "kyc_not_started",
);
check(
  "toutes les étapes PASS → prêt pour revue humaine (pas accordé)",
  aggregateKyc({
    steps: { identity: "PASS", address: "PASS", liveness: "PASS", iban: "PASS", income: "PASS" },
    requiredSteps: STEP_ORDER,
  }).state === "kyc_ready_for_review",
);
check(
  "une étape INCONCLUSIVE → preuve insuffisante",
  aggregateKyc({
    steps: {
      identity: "PASS",
      address: "PASS",
      liveness: "INCONCLUSIVE",
      iban: "PASS",
      income: "PASS",
    },
    requiredSteps: STEP_ORDER,
  }).state === "kyc_insufficient_evidence",
);
check(
  "une étape FAIL → preuve rejetée",
  aggregateKyc({
    steps: { identity: "FAIL", address: "PASS", liveness: "PASS", iban: "PASS", income: "PASS" },
    requiredSteps: STEP_ORDER,
  }).state === "kyc_rejected_evidence",
);

/* --------------------------- Moteur facial ----------------------------- */

section("Comparaison faciale (mathématiques réelles)");
const quality = {
  width: 220,
  height: 240,
  area_ratio: 0.12,
  detection_score: 0.94,
  sharpness: 48,
  brightness: 128,
  usable: true,
  reasons: [] as string[],
};
const badQuality = { ...quality, usable: false, reasons: ["face_blurred"] };
// Descripteurs déterministes : deux vecteurs 128D construits, pas tirés au hasard.
const base = Array.from({ length: 128 }, (_, i) => Math.sin(i / 7) * 0.1);
const near = base.map((v, i) => v + (i % 16 === 0 ? 0.01 : 0));
const far = base.map((v, i) => v + (i % 2 === 0 ? 0.12 : -0.12));
check("distance à soi-même = 0", descriptorDistance(base, base) === 0);
check("distance symétrique", descriptorDistance(base, far) === descriptorDistance(far, base));
check(
  "descripteurs de tailles différentes → erreur",
  (() => {
    try {
      descriptorDistance(base, base.slice(0, 64));
      return false;
    } catch {
      return true;
    }
  })(),
);
const matchOutcome = compareFaces({ descriptor: base, quality }, { descriptor: near, quality });
check(
  `visages proches → PASS (distance ${matchOutcome.distance})`,
  matchOutcome.status === "PASS" && (matchOutcome.distance ?? 1) <= FACE_MATCH_THRESHOLDS.match,
  matchOutcome,
);
const mismatchOutcome = compareFaces({ descriptor: base, quality }, { descriptor: far, quality });
check(
  `visages éloignés → FAIL (distance ${mismatchOutcome.distance})`,
  mismatchOutcome.status === "FAIL" &&
    (mismatchOutcome.distance ?? 0) >= FACE_MATCH_THRESHOLDS.mismatch,
  mismatchOutcome,
);
check(
  "portrait manquant → INCONCLUSIVE sans distance",
  (() => {
    const o = compareFaces(null, { descriptor: base, quality });
    return (
      o.status === "INCONCLUSIVE" &&
      o.distance === null &&
      o.reasons.includes("id_portrait_descriptor_missing")
    );
  })(),
);
check(
  "visage de session manquant → INCONCLUSIVE",
  compareFaces({ descriptor: base, quality }, null).status === "INCONCLUSIVE",
);
check(
  "qualité insuffisante → INCONCLUSIVE même avec distance faible",
  (() => {
    const o = compareFaces(
      { descriptor: base, quality: badQuality },
      { descriptor: near, quality },
    );
    return o.status === "INCONCLUSIVE" && o.reasons.includes("image_quality_insufficient");
  })(),
);

/* ------------------------ Sanctions et PEP ----------------------------- */

section("Filtrage sanctions / PEP");
check("noms identiques → 1", compareFullNames("Jean Dupont", "Jean Dupont") === 1);
check(
  "ordre des composants indifférent",
  compareFullNames("DUPONT Jean", "Jean Dupont") >= SCREENING_LIMITS.reviewScore,
  compareFullNames("DUPONT Jean", "Jean Dupont"),
);
check(
  "noms distincts sous le seuil",
  compareFullNames("Jean Dupont", "Sophie Martin") < SCREENING_LIMITS.minScore,
  compareFullNames("Jean Dupont", "Sophie Martin"),
);
const entries: ScreeningEntry[] = [
  {
    id: "entry-1",
    full_name: "Jean Dupont",
    aliases: ["Jean DUPOND"],
    birth_date: "1980-04-12",
    nationality: "FR",
    kind: "sanction",
    program: "EU-FSF",
  },
  {
    id: "entry-2",
    full_name: "Sophie Martin",
    birth_date: null,
    nationality: "BE",
    kind: "pep",
    program: "PEP-BE",
  },
];
const noList = screenCandidate({ first_name: "Jean", last_name: "Dupont" }, [], {
  version: null,
  source: null,
});
check("aucune entrée comparée → 0", noList.entries_screened === 0);
check(
  "aucune entrée → statut no_match sans liste (traité NOT_VERIFIED en amont)",
  noList.status === "no_match",
);
const exact = screenCandidate(
  { first_name: "Jean", last_name: "Dupont", birth_date: "1980-04-12", nationality: "FR" },
  entries,
  { version: "2026-01", source: "EU FSF" },
);
check(
  "homonyme exact → revue humaine obligatoire",
  exact.status === "match_review_required",
  exact.status,
);
check("correspondance tracée avec son entrée", exact.hits[0]?.entry_id === "entry-1", exact.hits);
check("date de naissance concordante détectée", exact.hits[0]?.birth_date_match === "match");
check(
  "version de liste conservée",
  exact.list_version === "2026-01" && exact.list_source === "EU FSF",
);
const otherBirth = screenCandidate(
  { first_name: "Jean", last_name: "Dupont", birth_date: "1991-09-02", nationality: "FR" },
  entries,
  { version: "2026-01", source: "EU FSF" },
);
check(
  "date de naissance différente écarte l'homonyme",
  otherBirth.status === "no_match",
  otherBirth,
);
const unknownBirth = screenCandidate({ first_name: "Jean", last_name: "Dupont" }, entries, {
  version: "2026-01",
  source: "EU FSF",
});
check(
  "date de naissance inconnue → jamais écartée automatiquement",
  unknownBirth.status !== "no_match" && unknownBirth.hits[0]?.birth_date_match === "unknown",
  unknownBirth.status,
);
check(
  "nom trop court → aucune correspondance fabriquée",
  screenCandidate({ first_name: "J", last_name: "" }, entries, { version: "x", source: "y" }).hits
    .length === 0,
);

/* --------------------- Import des listes officielles ------------------- */

section("Lecture des fichiers de listes");
check(
  "CSV : champs entre guillemets et virgule interne",
  JSON.stringify(splitCsvLine('1,"Dupont, Jean","FR"')) ===
    JSON.stringify(["1", "Dupont, Jean", "FR"]),
  splitCsvLine('1,"Dupont, Jean","FR"'),
);
const csv = [
  "id,name,aliases,dob,nationality,program,type",
  '1,"Jean Dupont","Jean DUPOND|J. Dupont",1980-04-12,FR,EU-FSF,person',
  '2,"Société Écran SA",,,BE,EU-FSF,entity',
  ",,,,,,",
].join("\n");
const parsedCsv = parseFile(csv, "test.csv");
check("CSV : lignes sans nom ignorées", parsedCsv.length === 2, parsedCsv.length);
check("CSV : alias multivalués découpés", parsedCsv[0]?.names.length === 3, parsedCsv[0]?.names);
check("CSV : nom principal en première position", parsedCsv[0]?.names[0] === "Jean Dupont");
check("CSV : type personne détecté", parsedCsv[0]?.entry_type === "person");
check("CSV : type entité détecté", parsedCsv[1]?.entry_type === "entity");
check("CSV : date de naissance conservée", parsedCsv[0]?.birth_dates[0] === "1980-04-12");
const parsedJson = parseFile(
  JSON.stringify({
    entries: [{ full_name: "Sophie Martin", nationalities: ["BE"], programs: ["PEP-BE"] }],
  }),
  "test.json",
);
check(
  "JSON : { entries: [...] } accepté",
  parsedJson.length === 1 && parsedJson[0]?.primary_name === "Sophie Martin",
);
check("entrée sans nom rejetée", normaliseEntry({ name: "" }) === null);
check(
  "les entrées importées alimentent réellement le filtrage",
  (() => {
    const imported: ScreeningEntry[] = parsedCsv.map((e, i) => ({
      id: `imported-${i}`,
      full_name: e.primary_name,
      aliases: e.names,
      birth_date: e.birth_dates[0] ?? null,
      nationality: e.nationalities[0] ?? null,
      kind: "sanction",
      program: e.programs[0] ?? null,
    }));
    const res = screenCandidate(
      { first_name: "Jean", last_name: "Dupont", birth_date: "1980-04-12" },
      imported,
      {
        version: "test",
        source: "test.csv",
      },
    );
    return res.status === "match_review_required" && res.entries_screened === 2;
  })(),
);

console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
process.exit(failed === 0 ? 0 : 1);
