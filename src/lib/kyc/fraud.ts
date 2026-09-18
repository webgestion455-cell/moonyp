/**
 * Moteur de signaux de risque documentaire et de session.
 *
 * Ces signaux ne prouvent jamais une fraude : ils déclenchent une revue
 * humaine et documentent le dossier. Aucun score n'est inventé — chaque
 * point de risque provient d'un fait mesuré (empreinte de fichier, nombre de
 * tentatives, incohérence de date, session de vivacité anormale).
 */

export type RiskStatus = "no_signal" | "low" | "medium" | "high";

export interface RiskSignal {
  code: string;
  severity: "info" | "low" | "medium" | "high";
  detail: Record<string, unknown>;
}

export interface RiskFacts {
  /** Empreintes SHA-256 des fichiers déposés pour ce dossier. */
  file_hashes: string[];
  /** Empreintes déjà connues, avec le dossier d'origine. */
  known_hashes: { hash: string; application_id: string }[];
  /** Nombre de dépôts déjà enregistrés pour ce dossier. */
  upload_attempts: number;
  /** Sessions de vivacité déjà tentées. */
  liveness_attempts: number;
  /** Nombre de visages détectés dans la session de vivacité. */
  faces_detected: number | null;
  /** Suspicion de présentation d'écran relevée par la capture. */
  screen_presentation_suspected: boolean;
  /** Document daté dans le futur, ou incohérent avec le dépôt. */
  future_dated_documents: string[];
  /** Pièce d'identité expirée. */
  identity_document_expired: boolean | null;
  /** Fichiers identiques déposés plusieurs fois dans ce même dossier. */
  duplicate_within_application: number;
  application_id: string;
}

const WEIGHT: Record<RiskSignal["severity"], number> = {
  info: 0,
  low: 10,
  medium: 25,
  high: 45,
};

export interface RiskAssessment {
  status: RiskStatus;
  /** Somme bornée des poids des signaux réellement relevés. */
  score: number;
  signals: RiskSignal[];
  review_required: boolean;
  evaluated_at: string;
}

export function assessRisk(facts: RiskFacts, at: Date = new Date()): RiskAssessment {
  const signals: RiskSignal[] = [];

  const foreign = facts.known_hashes.filter(
    (k) => facts.file_hashes.includes(k.hash) && k.application_id !== facts.application_id,
  );
  if (foreign.length > 0) {
    signals.push({
      code: "document_reused_across_applications",
      severity: "high",
      detail: { occurrences: foreign.length },
    });
  }

  if (facts.duplicate_within_application > 0) {
    signals.push({
      code: "duplicate_document_in_application",
      severity: "low",
      detail: { occurrences: facts.duplicate_within_application },
    });
  }

  if (facts.upload_attempts >= 6) {
    signals.push({
      code: "excessive_upload_attempts",
      severity: "medium",
      detail: { attempts: facts.upload_attempts },
    });
  }

  if (facts.liveness_attempts >= 5) {
    signals.push({
      code: "excessive_liveness_attempts",
      severity: "medium",
      detail: { attempts: facts.liveness_attempts },
    });
  }

  if (facts.faces_detected !== null && facts.faces_detected > 1) {
    signals.push({
      code: "multiple_faces_in_session",
      severity: "high",
      detail: { faces: facts.faces_detected },
    });
  }
  if (facts.faces_detected === 0) {
    signals.push({ code: "no_face_in_session", severity: "high", detail: {} });
  }

  if (facts.screen_presentation_suspected) {
    signals.push({ code: "screen_presentation_suspected", severity: "high", detail: {} });
  }

  if (facts.future_dated_documents.length > 0) {
    signals.push({
      code: "document_dated_in_future",
      severity: "medium",
      detail: { documents: facts.future_dated_documents.slice(0, 10) },
    });
  }

  if (facts.identity_document_expired === true) {
    signals.push({ code: "identity_document_expired", severity: "high", detail: {} });
  }

  const score = Math.min(
    100,
    signals.reduce((sum, s) => sum + WEIGHT[s.severity], 0),
  );
  const status: RiskStatus =
    signals.length === 0 ? "no_signal" : score >= 45 ? "high" : score >= 25 ? "medium" : "low";

  return {
    status,
    score,
    signals,
    review_required: status === "medium" || status === "high",
    evaluated_at: at.toISOString(),
  };
}
