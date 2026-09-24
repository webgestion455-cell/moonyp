/**
 * Décision KYC finale — module strictement serveur (`*.server.ts`).
 *
 * Entrées réellement utilisées :
 *   - l'identité déclarée au formulaire ;
 *   - le texte MRZ transmis par le client (jamais la MRZ « déjà décodée » :
 *     elle est re-parsée et re-vérifiée ici, clés de contrôle comprises) ;
 *   - les verdicts de capture (qualité image, anti-écran) revalidés par
 *     `evidence.server.ts` ;
 *   - le verdict de la session de vivacité.
 *
 * Sortie publique temporaire : `manual_review` pour chaque dossier, afin que
 * la conformité rende seule la décision finale. Le verdict technique
 * (`passed`, `manual_review` ou `failed`) reste calculé et conservé dans
 * `machine_decision` pour l'audit et sa réactivation future.
 *
 * Le verdict technique `passed` n'est calculé que si toutes les preuves
 * extraites et recoupées côté serveur concordent ; tout doute produit
 * `manual_review`, toute contradiction forte produit `failed`.
 */

import { parseMrz, type MrzData } from "./mrz";
import {
  crossCheckIdentity,
  type DeclaredIdentity,
  type IdentityCrossCheck,
} from "./identity-match";
import { controlsForStep, type ControlKey, type ControlStatus } from "./controls";

export type KycDecision = "passed" | "manual_review" | "failed";

export interface DecisionDocumentInput {
  document_type_slug: string;
  category: string;
  /** Verdict de capture déjà revalidé (statut + motifs + score). */
  capture_status: "verifying" | "passed" | "manual_review" | "failed";
  capture_reasons: string[];
  capture_score: number | null;
  capture_method: "scan" | "upload" | "liveness";
  /** Charge utile OCR transmise par le navigateur (texte brut uniquement). */
  ocr?: unknown;
}

/**
 * Résultat persisté d'un contrôle du moteur existant (`application_kyc_controls`,
 * produit par engine.server.ts / face-worker.server.ts). Aucun autre format.
 */
export interface DecisionControlInput {
  control: ControlKey | string;
  status: ControlStatus | string;
  executed: boolean;
  created_at?: string;
}

export interface DecisionInput {
  declared: DeclaredIdentity;
  documents: DecisionDocumentInput[];
  /** Contrôles réels déjà exécutés. Absents → contrôles non vérifiés. */
  controls?: DecisionControlInput[];
  at?: Date;
}

/**
 * Contrôles obligatoires (CONTROL_DEFINITIONS) dont dépend la validation
 * automatique, en plus de l'identité/MRZ/vivacité évaluées ici.
 */
const GATED_CONTROLS: { reason: string; failReason: string; keys: string[] }[] = [
  { reason: "face_match_not_performed", failReason: "face_match_failed", keys: ["face_match"] },
  {
    reason: "address_verification_not_performed",
    failReason: "address_verification_failed",
    keys: controlsForStep("address").filter((c) => c.required).map((c) => c.key),
  },
  {
    reason: "bank_statement_verification_not_performed",
    failReason: "bank_verification_failed",
    keys: controlsForStep("iban").filter((c) => c.required).map((c) => c.key),
  },
];

/** Dernier résultat par contrôle ; PASS non exécuté dégradé via sanitizeResult. */
function latestControls(controls: DecisionControlInput[]): Map<string, { status: string }> {
  const sorted = [...controls].sort((a, b) =>
    (a.created_at ?? "").localeCompare(b.created_at ?? ""),
  );
  const out = new Map<string, { status: string }>();
  for (const c of sorted) {
    const safe =
      c.status === "PASS" && !c.executed ? "INCONCLUSIVE" : String(c.status);
    out.set(String(c.control), { status: safe });
  }
  return out;
}

export interface DecisionResult {
  /** Décision opposable appliquée actuellement à tous les parcours. */
  decision: KycDecision;
  /** Verdict du moteur existant, informatif tant que la revue humaine est imposée. */
  machine_decision: KycDecision;
  /** Score global 0..100 (croisement d'identité pondéré par la qualité). */
  score: number;
  reasons: string[];
  identity: IdentityCrossCheck | null;
  mrz: (Omit<MrzData, "lines"> & { lines_masked: string[] }) | null;
  /** Document ayant porté la lecture MRZ. */
  source_document: string | null;
  ocr: {
    attempted: boolean;
    mrz_found: boolean;
    confidence: number | null;
    engine: string | null;
  };
  evaluated_at: string;
}

/** Seuils de décision — un seul endroit, volontairement explicite. */
export const DECISION_LIMITS = {
  /** Score de croisement minimal pour une validation automatique. */
  autoPassScore: 92,
  /** En dessous, le dossier est refusé sans revue possible. */
  hardFailScore: 45,
  /** Confiance OCR minimale pour exploiter la MRZ sans revue. */
  minOcrConfidence: 55,
  /** Score de capture minimal (qualité image) pour une validation auto. */
  minCaptureScore: 60,
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/** Masque une ligne MRZ conservée en base : seules les 5 dernières positions. */
function maskLine(line: string): string {
  if (line.length <= 5) return line;
  return `${"•".repeat(line.length - 5)}${line.slice(-5)}`;
}

function maskMrz(mrz: MrzData): Omit<MrzData, "lines"> & { lines_masked: string[] } {
  const { lines, ...rest } = mrz;
  return { ...rest, lines_masked: lines.map(maskLine) };
}

/**
 * Rend la décision finale. Ne lève jamais : toute anomalie de lecture bascule
 * en revue manuelle avec un motif explicite.
 */
export function decideKyc(input: DecisionInput): DecisionResult {
  const at = input.at ?? new Date();
  const reasons: string[] = [];

  const identityDocs = input.documents.filter((d) => d.category === "identity");
  const selfieDocs = input.documents.filter(
    (d) => d.category === "selfie" || d.capture_method === "liveness",
  );

  /* --------------------- 1. Lecture MRZ (re-parsée ici) -------------------- */
  let mrz: MrzData | null = null;
  let sourceDocument: string | null = null;
  let confidence: number | null = null;
  let engine: string | null = null;
  let attempted = false;

  for (const doc of identityDocs) {
    const payload = asRecord(doc.ocr);
    if (Object.keys(payload).length === 0) continue;
    attempted = true;
    const raw = `${text(payload["mrz_text"], 400)}\n${text(payload["viz_text"], 1200)}`;
    const parsed = parseMrz(raw);
    const conf = typeof payload["confidence"] === "number" ? payload["confidence"] : null;
    const eng = asRecord(payload["engine"]);
    if (parsed && (!mrz || parsed.checksum_ratio > mrz.checksum_ratio)) {
      mrz = parsed;
      sourceDocument = doc.document_type_slug;
      confidence = conf;
      engine = `${text(eng["name"], 40) || "unknown"}@${text(eng["version"], 20) || "0"}`;
    }
  }

  if (identityDocs.length === 0) reasons.push("no_identity_document");
  if (!attempted && identityDocs.length > 0) reasons.push("ocr_not_performed");
  if (attempted && !mrz) reasons.push("mrz_not_readable");
  if (confidence !== null && confidence < DECISION_LIMITS.minOcrConfidence)
    reasons.push("low_ocr_confidence");

  /* ----------------------- 2. Croisement des données ---------------------- */
  const identity = mrz ? crossCheckIdentity(input.declared, mrz, { at }) : null;
  if (identity) reasons.push(...identity.reasons);

  /* ------------------------ 3. Qualité des captures ----------------------- */
  const captureScores = input.documents
    .map((d) => d.capture_score)
    .filter((s): s is number => typeof s === "number");
  const minCapture = captureScores.length > 0 ? Math.min(...captureScores) : null;

  for (const doc of input.documents) {
    if (doc.capture_status === "failed") reasons.push(`capture_failed:${doc.document_type_slug}`);
    if (doc.capture_reasons.includes("screen_presentation_suspected"))
      reasons.push("screen_presentation_suspected");
    if (doc.capture_method === "upload" && doc.category === "identity")
      reasons.push("identity_document_uploaded");
  }
  if (minCapture !== null && minCapture < DECISION_LIMITS.minCaptureScore)
    reasons.push("low_capture_quality");

  /* --------------------------- 4. Vivacité -------------------------------- */
  if (selfieDocs.length === 0) reasons.push("no_liveness_session");
  const livenessFailed = selfieDocs.some((d) => d.capture_status === "failed");
  const livenessDoubt = selfieDocs.some(
    (d) => d.capture_status !== "passed" || d.capture_method !== "liveness",
  );
  if (livenessFailed) reasons.push("liveness_failed");
  if (livenessDoubt) reasons.push("liveness_doubt");

  /* --------------------------- 5. Arbitrage ------------------------------- */
  // Absence de lecture exploitable : vérification non aboutie, pas une
  // reconnaissance positive du type de document ou un refus de crédit.
  if (!mrz) reasons.push("identity_not_extracted");
  // Authenticité physique (hologrammes, NFC) : contrôle facultatif et
  // non vérifiable par construction (controls.ts) — motif d'audit informatif.
  reasons.push("independent_document_verification_required");

  // Contrôles obligatoires du moteur existant : seul un PASS réellement
  // exécuté lève le motif. FAIL → échec ; absent/NOT_VERIFIED/INCONCLUSIVE/
  // NOT_STARTED/REVIEW_REQUIRED → le motif « non vérifié » bloque `passed`.
  const latest = latestControls(input.controls ?? []);
  const blocking: string[] = [];
  let controlFailed = false;
  for (const gate of GATED_CONTROLS) {
    const statuses = gate.keys.map((k) => latest.get(k)?.status ?? "NOT_STARTED");
    if (statuses.some((s) => s === "FAIL")) {
      reasons.push(gate.failReason);
      controlFailed = true;
    } else if (!statuses.every((s) => s === "PASS")) {
      reasons.push(gate.reason);
      blocking.push(gate.reason);
    }
  }
  const unique = [...new Set(reasons)];
  const identityScore = identity?.score ?? 0;
  const qualityFactor =
    minCapture === null ? 0.85 : Math.min(1, Math.max(0.5, minCapture / 100 + 0.35));
  const score = Math.round(Math.max(0, Math.min(100, identityScore * qualityFactor)));

  const hardFail =
    !mrz ||
    selfieDocs.length === 0 ||
    selfieDocs.some((d) => d.capture_method !== "liveness") ||
    unique.includes("birth_date_mismatch") ||
    unique.includes("surname_mismatch") ||
    unique.includes("document_expired") ||
    unique.includes("liveness_failed") ||
    controlFailed ||
    (identity !== null && identityScore < DECISION_LIMITS.hardFailScore);

  // Validation automatique uniquement si TOUTES les preuves réellement
  // extraites et recoupées côté serveur sont concordantes : MRZ re-parsée avec
  // clés de contrôle valides, identité concordante au-dessus du seuil, pièce
  // non expirée, captures et vivacité validées par evidence.server.ts, OCR
  // suffisamment fiable. Le moindre doute bascule en revue manuelle.
  const DOUBT = [
    "mrz_checksum_failed",
    "given_names_mismatch",
    "birth_date_not_readable",
    "nationality_differs",
    "document_number_not_readable",
    "expiry_not_readable",
    "low_ocr_confidence",
    "low_capture_quality",
    "screen_presentation_suspected",
    "identity_document_uploaded",
    "liveness_doubt",
  ];
  const clean =
    mrz !== null &&
    mrz.checksums_valid &&
    identity !== null &&
    identityScore >= DECISION_LIMITS.autoPassScore &&
    score >= DECISION_LIMITS.autoPassScore - 10 &&
    (confidence === null || confidence >= DECISION_LIMITS.minOcrConfidence) &&
    identityDocs.some((d) => d.capture_status === "passed") &&
    input.documents.every((d) => d.capture_status === "passed") &&
    !unique.some((r) => DOUBT.includes(r) || r.startsWith("capture_failed:"));

  const machineDecision: KycDecision = hardFail ? "failed" : clean ? "passed" : "manual_review";

  // Politique temporaire commune aux demandes de prêt et aux liens KYC
  // externes : aucune décision machine n'est opposable sans revue humaine.
  // Le moteur, ses contrôles et ses trois verdicts restent intacts ci-dessus.
  const decision: KycDecision = "manual_review";

  return {
    decision,
    machine_decision: machineDecision,
    score,
    reasons: unique,
    identity,
    mrz: mrz ? maskMrz(mrz) : null,
    source_document: sourceDocument,
    ocr: { attempted, mrz_found: mrz !== null, confidence, engine },
    evaluated_at: at.toISOString(),
  };
}
