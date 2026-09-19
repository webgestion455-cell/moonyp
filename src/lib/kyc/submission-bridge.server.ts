/**
 * Raccordement dépôt → moteur KYC.
 *
 * Constat (diagnostic CR-2026-000020) : le parcours candidat n'appelle jamais
 * `submitKycStep`. Les pièces sont déposées en une seule fois au moment du
 * dépôt du dossier (`registerDocuments`), après création du token ; les
 * tables lues par le panneau admin (`application_kyc_sessions`,
 * `application_kyc_steps`, `application_kyc_controls`,
 * `application_kyc_face_jobs`, `application_kyc_audit_events`) n'étaient donc
 * jamais alimentées — d'où « kyc_not_started » et 26 contrôles « Non exécuté ».
 *
 * Ce module exécute le moteur réel (`processStep`, inchangé) sur les pièces
 * réellement déposées, étape par étape et dans l'ordre imposé par le moteur.
 *
 * Règles :
 *   - aucune donnée inventée : seuls les fichiers présents dans le bucket et
 *     les mesures transmises à la capture sont analysés ;
 *   - une étape sans pièce n'est PAS exécutée (elle reste NOT_STARTED, jamais
 *     INCONCLUSIVE ou PASS par défaut) ;
 *   - la règle séquentielle du moteur est respectée : si une étape précédente
 *     est absente ou FAIL, le moteur refuse la suivante et l'audit le note ;
 *   - une erreur technique n'est jamais convertie en statut : elle est
 *     journalisée (audit `kyc_engine_error`) et l'étape reste sans résultat.
 */

import { STEP_DOCUMENT_CATEGORY, STEP_ORDER, type StepKey, type StepStatus } from "./controls";
import { verifyCaptureEvidence } from "./evidence.server";
import { audit } from "./persistence.server";
import {
  loadRequiredSteps,
  loadSubject,
  processStep,
  type SubmittedFile,
} from "./orchestrator.server";

export interface SubmittedDocumentForEngine {
  document_type_slug: string;
  /** Catégorie réelle du catalogue `document_types.category`. */
  category: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  capture_evidence?: unknown;
  /** Lecture navigateur brute (images) : texte MRZ / zone visuelle. */
  ocr?: unknown;
}

export type EngineStepOutcome =
  | { step: StepKey; outcome: "recorded"; status: StepStatus; attempt: number }
  | { step: StepKey; outcome: "skipped"; reason: string }
  | { step: StepKey; outcome: "rejected"; reason: string }
  | { step: StepKey; outcome: "error"; message: string };

export interface EngineSubmissionResult {
  session_id: string | null;
  required_steps: StepKey[];
  outcomes: EngineStepOutcome[];
}

/** Texte brut transmis par le navigateur, sans interprétation. */
function clientText(ocr: unknown): string | null {
  if (!ocr || typeof ocr !== "object") return null;
  const raw = ocr as { mrz_text?: unknown; viz_text?: unknown };
  const parts = [raw.mrz_text, raw.viz_text].filter(
    (p): p is string => typeof p === "string" && p.trim().length > 0,
  );
  return parts.length > 0 ? parts.join("\n") : null;
}

function toSubmittedFile(doc: SubmittedDocumentForEngine): SubmittedFile {
  return {
    document_type_slug: doc.document_type_slug,
    storage_path: doc.storage_path,
    file_name: doc.file_name,
    mime_type: doc.mime_type,
    file_size: doc.file_size,
    capture_evidence: doc.capture_evidence,
    ocr_text: clientText(doc.ocr),
  };
}

export async function runEngineForSubmission(input: {
  applicationId: string;
  language: string | null;
  documents: SubmittedDocumentForEngine[];
}): Promise<EngineSubmissionResult> {
  const subject = await loadSubject(input.applicationId);
  const { steps: requiredSteps } = await loadRequiredSteps(subject);

  const byStep = new Map<StepKey, SubmittedDocumentForEngine[]>();
  for (const step of STEP_ORDER) {
    const category = STEP_DOCUMENT_CATEGORY[step];
    byStep.set(
      step,
      input.documents.filter(
        (d) => d.category === category && d.storage_path.startsWith(`${input.applicationId}/`),
      ),
    );
  }

  const outcomes: EngineStepOutcome[] = [];
  let sessionId: string | null = null;

  for (const step of STEP_ORDER) {
    if (!requiredSteps.includes(step)) continue;
    const docs = byStep.get(step) ?? [];

    if (docs.length === 0) {
      outcomes.push({ step, outcome: "skipped", reason: "no_document_submitted_for_step" });
      continue;
    }

    try {
      if (step === "liveness") {
        // Seule une capture réellement produite par la session de vivacité
        // (méthode mesurée « liveness ») vaut preuve ; un simple selfie
        // importé n'est pas une session de vivacité.
        const live = docs.find(
          (d) => verifyCaptureEvidence(d.capture_evidence).method === "liveness",
        );
        if (!live) {
          outcomes.push({ step, outcome: "skipped", reason: "no_liveness_session_evidence" });
          continue;
        }
        const res = await processStep({
          applicationId: input.applicationId,
          step,
          files: docs.map(toSubmittedFile),
          language: input.language,
          livenessEvidence: live.capture_evidence,
          livenessFrames: [
            { storage_path: live.storage_path, challenge: null },
            ...docs
              .filter((d) => d.storage_path !== live.storage_path)
              .map((d) => ({ storage_path: d.storage_path, challenge: null })),
          ],
        });
        sessionId = res.session_id;
        outcomes.push({ step, outcome: "recorded", status: res.status, attempt: res.attempt });
        continue;
      }

      const res = await processStep({
        applicationId: input.applicationId,
        step,
        files: docs.map(toSubmittedFile),
        language: input.language,
      });
      sessionId = res.session_id;
      outcomes.push({ step, outcome: "recorded", status: res.status, attempt: res.attempt });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Refus séquentiel du moteur (étape précédente absente ou FAIL) : ce
      // n'est pas une panne, c'est la règle métier, déjà auditée par
      // `processStep` (`kyc_step_rejected`).
      if (message.startsWith("previous_step_incomplete") || message === "step_not_in_plan") {
        outcomes.push({ step, outcome: "rejected", reason: message });
        continue;
      }
      outcomes.push({ step, outcome: "error", message });
      try {
        await audit({
          application_id: input.applicationId,
          session_id: sessionId,
          event_type: "kyc_engine_error",
          step_key: step,
          payload: { message },
        });
      } catch (auditErr) {
        console.error("[kyc-bridge] audit write failed", auditErr);
      }
    }
  }

  try {
    await audit({
      application_id: input.applicationId,
      session_id: sessionId,
      event_type: "kyc_engine_submission",
      payload: {
        required_steps: requiredSteps,
        documents: input.documents.map((d) => ({
          slug: d.document_type_slug,
          category: d.category,
          storage_path: d.storage_path,
        })),
        outcomes,
      },
    });
  } catch (auditErr) {
    console.error("[kyc-bridge] audit write failed", auditErr);
  }

  return { session_id: sessionId, required_steps: requiredSteps, outcomes };
}
