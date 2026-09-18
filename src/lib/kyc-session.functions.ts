/**
 * Parcours KYC séquentiel — fonctions serveur.
 *
 * Le navigateur ne fait que déposer des fichiers dans le bucket privé et
 * transmettre ses mesures de capture. Tout le reste (analyse binaire, texte,
 * MRZ, cohérence, screening, statuts) est calculé ici et écrit en base par le
 * serveur. Aucun statut ne peut être imposé depuis le client : les entrées
 * acceptées ne contiennent ni statut, ni score, ni verdict.
 *
 * Aucune donnée n'est transmise à un fournisseur KYC externe : lecture du
 * stockage privé Moonyp, calcul local, écriture en base Moonyp.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { STEP_ORDER } from "@/lib/kyc/controls";

const stepSchema = z.enum(["identity", "address", "liveness", "iban", "income"]);

const fileSchema = z.object({
  document_type_slug: z.string().min(1).max(60),
  storage_path: z.string().min(1).max(400),
  file_name: z.string().min(1).max(255),
  mime_type: z.string().min(1).max(120),
  file_size: z.coerce
    .number()
    .int()
    .min(1)
    .max(25 * 1024 * 1024),
  /** Mesures brutes de la capture, revalidées côté serveur. */
  capture_evidence: z.unknown().optional(),
  /** Texte lu par le navigateur (images) — source non authentifiée. */
  ocr_text: z.string().max(20_000).nullable().optional(),
});

/** Ouvre (ou reprend) la session KYC du dossier et renvoie son état réel. */
export const startKycSession = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        token: z.string().min(20).max(200),
        language: z.string().max(10).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const server = await import("@/lib/applications.server");
    const applicationId = await server.resolveToken(data.token);
    if (!applicationId) throw new Error("invalid_token");

    const { readSession } = await import("@/lib/kyc/orchestrator.server");
    const view = await readSession(applicationId, data.language ?? null);
    return publicView(view);
  });

/** État courant du parcours, sans rien recalculer. */
export const getKycSession = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        token: z.string().min(20).max(200),
        language: z.string().max(10).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const server = await import("@/lib/applications.server");
    const applicationId = await server.resolveToken(data.token);
    if (!applicationId) throw new Error("invalid_token");
    const { readSession } = await import("@/lib/kyc/orchestrator.server");
    return publicView(await readSession(applicationId, data.language ?? null));
  });

/**
 * Soumet une étape : le serveur analyse réellement les pièces déposées et
 * enregistre un résultat par contrôle. L'ordre des étapes est imposé côté
 * serveur — sauter une étape est refusé.
 */
export const submitKycStep = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        token: z.string().min(20).max(200),
        step: stepSchema,
        language: z.string().max(10).nullable().optional(),
        files: z.array(fileSchema).max(6).default([]),
        /** Preuve mesurée de la session de vivacité. */
        liveness_evidence: z.unknown().optional(),
        /** Images de vivacité déposées dans le bucket privé. */
        liveness_frames: z
          .array(
            z.object({
              storage_path: z.string().min(1).max(400),
              challenge: z.string().max(40).nullable().optional(),
            }),
          )
          .max(12)
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const server = await import("@/lib/applications.server");
    const applicationId = await server.resolveToken(data.token);
    if (!applicationId) throw new Error("invalid_token");

    if (!server.rateLimit(`kyc-step:${applicationId}`, 40, 10 * 60 * 1000))
      throw new Error("rate_limited");

    const { processStep, readSession } = await import("@/lib/kyc/orchestrator.server");
    const outcome = await processStep({
      applicationId,
      step: data.step,
      files: data.files,
      language: data.language ?? null,
      livenessEvidence: data.liveness_evidence,
      livenessFrames: data.liveness_frames,
    });

    const view = await readSession(applicationId, data.language ?? null);
    return {
      ...publicView(view),
      submitted_step: outcome.step,
      submitted_status: outcome.status,
      attempt: outcome.attempt,
    };
  });

/**
 * Vue client : statuts par étape et par contrôle, sans motifs machine, sans
 * score, sans donnée lue sur les pièces. Un contrôle non exécuté est
 * explicitement signalé comme tel — jamais présenté comme « vérifié ».
 */
function publicView(view: {
  session_id: string;
  required_steps: readonly string[];
  steps: { step: string; status: string; attempt: number }[];
  current_step: string | null;
  controls: {
    control_key: string;
    step_key: string;
    status: string;
    executed: boolean;
    attempt: number;
  }[];
  aggregate: string;
}) {
  const latest = new Map<
    string,
    { status: string; executed: boolean; attempt: number; step: string }
  >();
  for (const c of view.controls) {
    const known = latest.get(c.control_key);
    if (!known || c.attempt >= known.attempt) {
      latest.set(c.control_key, {
        status: c.status,
        executed: c.executed,
        attempt: c.attempt,
        step: c.step_key,
      });
    }
  }
  return {
    session_id: view.session_id,
    required_steps: STEP_ORDER.filter((s) => view.required_steps.includes(s)),
    steps: view.steps.map((s) => ({ step: s.step, status: s.status, attempt: s.attempt })),
    current_step: view.current_step,
    controls: [...latest.entries()].map(([control, v]) => ({
      control,
      step: v.step,
      status: v.status,
      executed: v.executed,
    })),
    kyc_state: view.aggregate,
  };
}

export type KycSessionView = Awaited<ReturnType<typeof getKycSession>>;
