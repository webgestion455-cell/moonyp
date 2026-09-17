/**
 * Évaluation KYC côté serveur — appelée depuis le parcours d'identité avant
 * la soumission du dossier.
 *
 * Point capital : AUCUNE décision n'est prise par le navigateur. Le client
 * n'envoie que des mesures brutes (preuves de capture, texte OCR/MRZ) et
 * l'identité déclarée ; le serveur revalide chaque preuve
 * (`evidence.server.ts`), re-décode la MRZ, croise les données et rend la
 * décision (`decision.server.ts`). Le résultat affiché à l'écran est donc
 * exactement celui du back-end, sans recalcul ni stockage local.
 *
 * Cette évaluation est une pré-décision d'affichage : la décision opposable
 * est celle écrite en base au moment du dépôt (`registerDocuments`), avec le
 * même moteur et les mêmes seuils.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const documentSchema = z.object({
  document_type_slug: z.string().min(1).max(60),
  category: z.string().min(1).max(30),
  capture_method: z.enum(["scan", "upload", "liveness"]),
  /** Mesures produites par le scanner ou la session de vivacité. */
  capture_evidence: z.unknown().optional(),
  /** Lecture OCR/MRZ produite par le navigateur (texte brut uniquement). */
  ocr: z.unknown().optional(),
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

    const result = decideKyc({
      declared: {
        first_name: data.identity.first_name ?? "",
        last_name: data.identity.last_name ?? "",
        birth_date: data.identity.birth_date ?? "",
        nationality: data.identity.nationality ?? "",
      },
      documents,
    });

    // Seul le strict nécessaire revient au navigateur : jamais la MRZ, jamais
    // le détail d'identité lu sur la pièce.
    return {
      decision: result.decision,
      score: result.score,
      reasons: result.reasons,
      mrz_found: result.ocr.mrz_found,
      checks: result.identity
        ? result.identity.fields.map((f) => ({ field: f.field, status: f.status }))
        : [],
      evaluated_at: result.evaluated_at,
    };
  });

export type KycAssessment = Awaited<ReturnType<typeof assessKyc>>;
