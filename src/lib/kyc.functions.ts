/**
 * Évaluation KYC côté serveur — appelée depuis le parcours d'identité avant
 * la soumission du dossier.
 *
 * Point capital : AUCUNE décision n'est prise par le navigateur. Le client
 * n'envoie que des mesures brutes (preuves de capture, texte OCR/MRZ,
 * imagettes de visage) et l'identité déclarée ; le serveur revalide chaque
 * preuve (`evidence.server.ts`), re-décode la MRZ, compare réellement le
 * visage de la pièce au visage capté en vivacité (`face-compare.server.ts`),
 * croise les données et rend la décision (`decision.server.ts`). Le résultat
 * affiché à l'écran est donc exactement celui du back-end, sans recalcul ni
 * stockage local.
 *
 * Cette évaluation est une pré-décision d'affichage : la décision opposable
 * est celle écrite en base au moment du dépôt (`registerDocuments`), avec le
 * même moteur et les mêmes seuils.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Imagette de visage transmise par le parcours, comparée côté serveur. */
const faceSchema = z.object({
  /** JPEG/PNG base64 du visage recadré (aucun descripteur, aucun verdict). */
  image_base64: z.string().max(700_000).optional(),
  faces_detected: z.number().int().min(0).max(50).optional(),
  face_size_px: z.number().min(0).max(10_000).optional(),
  source: z.enum(["document", "live"]).optional(),
});

const documentSchema = z.object({
  document_type_slug: z.string().min(1).max(60),
  category: z.string().min(1).max(30),
  capture_method: z.enum(["scan", "upload", "liveness"]),
  /** Mesures produites par le scanner ou la session de vivacité. */
  capture_evidence: z.unknown().optional(),
  /** Lecture OCR/MRZ produite par le navigateur (texte brut uniquement). */
  ocr: z.unknown().optional(),
  /** Preuve faciale : pixels uniquement, jamais une conclusion. */
  face: faceSchema.optional(),
});

export const assessKyc = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        identity: z.object({
          first_name: z.string().max(120).optional(),
          last_name: z.string().max(120).optional(),
          birth_date: z.string().max(40).optional(),
          nationality: z.string().max(3).optional(),
        }),
        documents: z.array(documentSchema).min(1).max(24),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { verifyCaptureEvidence } = await import("@/lib/kyc/evidence.server");
    const { decideKyc } = await import("@/lib/kyc/decision.server");
    const { compareFaces } = await import("@/lib/kyc/face-compare.server");

    const documents = data.documents.map((doc) => {
      const verdict = verifyCaptureEvidence(doc.capture_evidence);
      return {
        document_type_slug: doc.document_type_slug,
        category: doc.category,
        capture_status: verdict.status,
        capture_reasons: verdict.reasons,
        capture_score: verdict.score,
        capture_method: doc.capture_method,
        ocr: doc.ocr,
      };
    });

    /* Correspondance faciale : le visage de la pièce d'identité est comparé au
     * visage capté pendant le contrôle de vivacité. La comparaison, le seuil
     * et le verdict sont serveur ; le navigateur n'a fourni que des pixels. */
    const documentFace = data.documents.find(
      (d) => d.category === "identity" && d.face?.image_base64,
    )?.face;
    const liveFace = data.documents.find(
      (d) => (d.category === "selfie" || d.capture_method === "liveness") && d.face?.image_base64,
    )?.face;

    const faceMatch = documentFace || liveFace ? await compareFaces(documentFace, liveFace) : null;

    const result = decideKyc({
      declared: {
        first_name: data.identity.first_name ?? "",
        last_name: data.identity.last_name ?? "",
        birth_date: data.identity.birth_date ?? "",
        nationality: data.identity.nationality ?? "",
      },
      documents,
      faceMatch,
    });

    // Le navigateur reçoit la décision et le récapitulatif d'étapes qui lui est
    // destiné. Le score, les motifs machine, la MRZ, l'identité lue et les
    // métriques biométriques restent des données de conformité : elles ne
    // sortent pas du dossier interne et de la piste d'audit.
    return {
      decision: result.decision,
      checklist: result.checklist,
      evaluated_at: result.evaluated_at,
    };
  });

export type KycAssessment = Awaited<ReturnType<typeof assessKyc>>;
