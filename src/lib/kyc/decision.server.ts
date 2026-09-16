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
 * Sortie : une décision bancaire explicite — `passed`, `manual_review` ou
 * `failed` — accompagnée d'un score, des motifs machine et de la piste
 * d'audit complète (comparaison champ par champ).
 *
 * Principe de prudence : aucune décision positive automatique n'est rendue si
 * une pièce d'identité lisible et une vivacité conforme ne sont pas toutes
 * deux présentes. Le doute va toujours en revue manuelle, jamais en
 * acceptation.
 */

import { parseMrz, type MrzData } from "./mrz";
import {
  crossCheckIdentity,
  type DeclaredIdentity,
  type IdentityCrossCheck,
} from "./identity-match";

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
  at?: Date;
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
  const livenessDoubt = selfieDocs.some((d) => d.capture_status === "manual_review");
  if (livenessFailed) reasons.push("liveness_failed");
  if (livenessDoubt) reasons.push("liveness_doubt");

  /* --------------------------- 5. Arbitrage ------------------------------- */
  const unique = [...new Set(reasons)];
  const identityScore = identity?.score ?? 0;
  const qualityFactor =
    minCapture === null ? 0.85 : Math.min(1, Math.max(0.5, minCapture / 100 + 0.35));
  const score = Math.round(Math.max(0, Math.min(100, identityScore * qualityFactor)));

  const hardFail =
    unique.includes("birth_date_mismatch") ||
    unique.includes("surname_mismatch") ||
    unique.includes("document_expired") ||
    unique.includes("liveness_failed") ||
    (identity !== null && identityScore < DECISION_LIMITS.hardFailScore);

  const autoPass =
    !hardFail &&
    identity !== null &&
    mrz !== null &&
    mrz.checksums_valid &&
    identityScore >= DECISION_LIMITS.autoPassScore &&
    selfieDocs.length > 0 &&
    !livenessFailed &&
    !livenessDoubt &&
    (minCapture === null || minCapture >= DECISION_LIMITS.minCaptureScore) &&
    (confidence === null || confidence >= DECISION_LIMITS.minOcrConfidence) &&
    !unique.includes("screen_presentation_suspected") &&
    !unique.includes("identity_document_uploaded") &&
    !unique.some((r) => r.startsWith("capture_failed:"));

  const decision: KycDecision = hardFail ? "failed" : autoPass ? "passed" : "manual_review";

  return {
    decision,
    score,
    reasons: unique,
    identity,
    mrz: mrz ? maskMrz(mrz) : null,
    source_document: sourceDocument,
    ocr: { attempted, mrz_found: mrz !== null, confidence, engine },
    evaluated_at: at.toISOString(),
  };
}
