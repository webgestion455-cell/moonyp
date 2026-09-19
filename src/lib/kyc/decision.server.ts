/**
 * Décision KYC finale — module strictement serveur (`*.server.ts`).
 *
 * Pipeline réellement appliqué, dans cet ordre :
 *
 *   capture document
 *        ↓ analyse document / OCR-MRZ (re-parsée ici, clés recalculées)
 *        ↓ extraction du visage du document (preuve transmise, recadrée)
 *        ↓ contrôle qualité (scores de capture revalidés serveur)
 *        ↓ contrôle de vivacité (session revalidée serveur)
 *        ↓ extraction du visage vivant
 *        ↓ face matching document ↔ vivacité (`face-compare.server.ts`)
 *        ↓ vérification de cohérence identité déclarée ↔ OCR
 *        ↓ décision serveur : passed / manual_review / failed
 *
 * Invariants non négociables :
 *   - aucune valeur « décision » envoyée par le navigateur n'est lue ;
 *   - la vivacité ne vaut JAMAIS, à elle seule, identité vérifiée ;
 *   - une donnée optionnelle absente ne produit jamais `failed`, mais
 *     `manual_review` ;
 *   - `failed` exige une condition bloquante démontrée ;
 *   - tous les seuils viennent de `thresholds.server.ts`.
 */

import { parseMrz, type MrzData } from "./mrz";
import {
  crossCheckIdentity,
  type DeclaredIdentity,
  type IdentityCrossCheck,
} from "./identity-match";
import type { FaceMatchOutcome } from "./face-compare.server";
import {
  DOCUMENT_QUALITY_FLOOR,
  DOCUMENT_QUALITY_THRESHOLD,
  IDENTITY_MATCH_FLOOR,
  IDENTITY_MATCH_THRESHOLD,
  KYC_THRESHOLDS,
  OCR_CONFIDENCE_THRESHOLD,
} from "./thresholds.server";

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

export interface DecisionInput {
  declared: DeclaredIdentity;
  documents: DecisionDocumentInput[];
  /**
   * Résultat de la comparaison faciale calculée côté serveur
   * (`compareFaces()` ou résultat du worker biométrique). Jamais un booléen
   * transmis par le client.
   */
  faceMatch?: FaceMatchOutcome | null;
  at?: Date;
}

/** Élément du récapitulatif présenté au client. */
export type ChecklistKey =
  | "identity_document"
  | "document_analysis"
  | "liveness"
  | "face_match"
  | "bank"
  | "income";

export type ChecklistStatus = "passed" | "review" | "failed" | "missing";

export interface ChecklistItem {
  key: ChecklistKey;
  status: ChecklistStatus;
}

/** Vue non biométrique du face match, sûre à journaliser et à persister. */
export interface FaceMatchSummary {
  compared: boolean;
  similarity: number | null;
  threshold: number;
  passed: boolean;
  band: FaceMatchOutcome["band"];
  reasons: string[];
  engine: string;
  engine_version: string;
  method: string;
  document_faces: number | null;
  live_faces: number | null;
  compared_at: string;
}

export interface DecisionResult {
  decision: KycDecision;
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
  face_match: FaceMatchSummary | null;
  checklist: ChecklistItem[];
  thresholds: typeof KYC_THRESHOLDS;
  evaluated_at: string;
}

/**
 * Seuils de décision — conservés pour compatibilité, tous dérivés de
 * `thresholds.server.ts`, source unique de vérité.
 */
export const DECISION_LIMITS = {
  autoPassScore: IDENTITY_MATCH_THRESHOLD,
  hardFailScore: IDENTITY_MATCH_FLOOR,
  minOcrConfidence: OCR_CONFIDENCE_THRESHOLD,
  minCaptureScore: DOCUMENT_QUALITY_THRESHOLD,
  captureFloor: DOCUMENT_QUALITY_FLOOR,
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

function summariseFaceMatch(match: FaceMatchOutcome | null | undefined): FaceMatchSummary | null {
  if (!match) return null;
  return {
    compared: match.compared,
    similarity: match.similarity,
    threshold: match.threshold,
    passed: match.passed,
    band: match.band,
    reasons: match.reasons,
    engine: match.engine,
    engine_version: match.engine_version,
    method: match.method,
    document_faces: match.document_faces,
    live_faces: match.live_faces,
    compared_at: match.compared_at,
  };
}

/**
 * Motifs machine réellement bloquants. Chacun décrit une condition démontrée,
 * jamais une donnée manquante.
 */
const HARD_FAIL_REASONS = new Set([
  "identity_face_match_failed",
  "multiple_faces_on_document",
  "multiple_faces_on_live_capture",
  "liveness_failed",
  "document_expired",
  "surname_mismatch",
  "birth_date_mismatch",
  "identity_contradiction",
  "identity_document_unusable",
  "replayed_liveness_suspected",
]);

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
  const bankDocs = input.documents.filter((d) => d.category === "bank");
  const incomeDocs = input.documents.filter((d) => d.category === "income");

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
  if (mrz) reasons.push("identity_document_read");
  if (confidence !== null && confidence < OCR_CONFIDENCE_THRESHOLD)
    reasons.push("low_ocr_confidence");
  else if (mrz) reasons.push("identity_ocr_passed");

  /* ----------------------- 2. Croisement des données ---------------------- */
  const identity = mrz ? crossCheckIdentity(input.declared, mrz, { at }) : null;
  if (identity) reasons.push(...identity.reasons);
  const identityScore = identity?.score ?? 0;
  if (identity && identityScore >= IDENTITY_MATCH_THRESHOLD)
    reasons.push("identity_data_match_passed");
  if (identity && identityScore < IDENTITY_MATCH_FLOOR) reasons.push("identity_contradiction");

  /* ------------------------ 3. Qualité des captures ----------------------- */
  const identityCaptureScores = identityDocs
    .map((d) => d.capture_score)
    .filter((s): s is number => typeof s === "number");
  const minIdentityCapture =
    identityCaptureScores.length > 0 ? Math.min(...identityCaptureScores) : null;

  for (const doc of input.documents) {
    if (doc.capture_status === "failed") reasons.push(`capture_failed:${doc.document_type_slug}`);
    if (doc.capture_reasons.includes("screen_presentation_suspected"))
      reasons.push("screen_presentation_suspected");
    if (doc.capture_method === "upload" && doc.category === "identity")
      reasons.push("identity_document_uploaded");
  }

  const identityQualityOk =
    identityDocs.length > 0 &&
    identityDocs.every((d) => d.capture_status === "passed") &&
    (minIdentityCapture === null || minIdentityCapture >= DOCUMENT_QUALITY_THRESHOLD);

  if (identityQualityOk) reasons.push("identity_document_quality_passed");
  else if (identityDocs.length > 0) reasons.push("identity_document_quality_insufficient");

  if (minIdentityCapture !== null && minIdentityCapture < DOCUMENT_QUALITY_FLOOR)
    reasons.push("identity_document_unusable");

  /* --------------------------- 4. Vivacité -------------------------------- */
  if (selfieDocs.length === 0) reasons.push("no_liveness_session");
  const livenessFailed = selfieDocs.some((d) => d.capture_status === "failed");
  const livenessPassed =
    selfieDocs.length > 0 &&
    selfieDocs.every((d) => d.capture_status === "passed" && d.capture_method === "liveness");
  if (livenessFailed) reasons.push("liveness_failed");
  else if (livenessPassed) reasons.push("liveness_passed");
  else if (selfieDocs.length > 0) reasons.push("liveness_doubt");
  if (selfieDocs.some((d) => d.capture_reasons.includes("reaction_too_fast")))
    reasons.push("replayed_liveness_suspected");

  /* ----------------------- 5. Correspondance faciale ---------------------- */
  const face = input.faceMatch ?? null;
  if (!face) reasons.push("identity_face_match_not_performed");
  else {
    reasons.push(...face.reasons);
    if (!face.compared) reasons.push("identity_face_match_not_performed");
  }
  const faceMatchPassed = face?.compared === true && face.passed === true;

  /* ------------------------ 6. Pièces complémentaires --------------------- */
  const bankFailed = bankDocs.some((d) => d.capture_status === "failed");
  const incomeFailed = incomeDocs.some((d) => d.capture_status === "failed");
  if (bankFailed) reasons.push("bank_document_rejected");
  if (incomeFailed) reasons.push("income_document_rejected");

  /* --------------------------- 7. Arbitrage ------------------------------- */
  const unique = [...new Set(reasons)];

  const qualityFactor =
    minIdentityCapture === null
      ? 0.85
      : Math.min(1, Math.max(0.5, minIdentityCapture / 100 + 0.35));
  const faceFactor = faceMatchPassed ? 1 : face?.band === "borderline" ? 0.8 : 0.6;
  const score = Math.round(Math.max(0, Math.min(100, identityScore * qualityFactor * faceFactor)));

  const hardFail = unique.some((r) => HARD_FAIL_REASONS.has(r)) || bankFailed || incomeFailed;

  // Conditions obligatoires cumulatives d'une validation automatique.
  const autoPass =
    !hardFail &&
    identityDocs.length > 0 &&
    identityQualityOk &&
    mrz !== null &&
    (confidence === null || confidence >= OCR_CONFIDENCE_THRESHOLD) &&
    identity !== null &&
    identityScore >= IDENTITY_MATCH_THRESHOLD &&
    livenessPassed &&
    faceMatchPassed &&
    face?.document_faces !== 0 &&
    face?.live_faces !== 0 &&
    !unique.includes("screen_presentation_suspected") &&
    !unique.includes("identity_document_uploaded");

  const decision: KycDecision = hardFail ? "failed" : autoPass ? "passed" : "manual_review";
  if (decision === "passed") unique.push("kyc_auto_passed");
  if (decision === "manual_review") unique.push("manual_review_required");

  /* ------------------------- 8. Récapitulatif client ---------------------- */
  const itemStatus = (present: boolean, ok: boolean, blocked: boolean): ChecklistStatus =>
    !present ? "missing" : blocked ? "failed" : ok ? "passed" : "review";

  const checklist: ChecklistItem[] = [
    {
      key: "identity_document",
      status: itemStatus(
        identityDocs.length > 0,
        identityQualityOk,
        unique.includes("identity_document_unusable") ||
          identityDocs.some((d) => d.capture_status === "failed"),
      ),
    },
    {
      key: "document_analysis",
      status: itemStatus(
        identityDocs.length > 0,
        mrz !== null && identity !== null && identityScore >= IDENTITY_MATCH_THRESHOLD,
        unique.includes("identity_contradiction") ||
          unique.includes("document_expired") ||
          unique.includes("surname_mismatch") ||
          unique.includes("birth_date_mismatch"),
      ),
    },
    {
      key: "liveness",
      status: itemStatus(selfieDocs.length > 0, livenessPassed, livenessFailed),
    },
    {
      key: "face_match",
      status: itemStatus(
        face !== null,
        faceMatchPassed,
        face?.band === "mismatch" ||
          unique.includes("multiple_faces_on_document") ||
          unique.includes("multiple_faces_on_live_capture"),
      ),
    },
    {
      key: "bank",
      status: itemStatus(
        bankDocs.length > 0,
        bankDocs.length > 0 && bankDocs.every((d) => d.capture_status !== "failed"),
        bankFailed,
      ),
    },
    {
      key: "income",
      status: itemStatus(
        incomeDocs.length > 0,
        incomeDocs.length > 0 && incomeDocs.every((d) => d.capture_status !== "failed"),
        incomeFailed,
      ),
    },
  ];

  return {
    decision,
    score,
    reasons: [...new Set(unique)],
    identity,
    mrz: mrz ? maskMrz(mrz) : null,
    source_document: sourceDocument,
    ocr: { attempted, mrz_found: mrz !== null, confidence, engine },
    face_match: summariseFaceMatch(face),
    checklist,
    thresholds: KYC_THRESHOLDS,
    evaluated_at: at.toISOString(),
  };
}
