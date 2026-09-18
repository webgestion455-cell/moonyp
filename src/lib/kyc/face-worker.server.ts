/**
 * Traitement des travaux du moteur facial Moonyp.
 *
 * Ce module est exécuté **uniquement** par le worker interne
 * (`scripts/kyc-face-worker.ts`), sur un processus Node/Bun de
 * l'infrastructure Moonyp. Il n'est jamais importé par l'application : le
 * runtime edge ne peut pas charger les poids TensorFlow.js.
 *
 * Ce qui entre :  les octets d'une ou deux images du bucket privé
 *                 `kyc-documents` (lecture service_role).
 * Ce qui sort  :  des métriques (nombre de visages, qualité, distance
 *                 euclidienne) écrites dans `application_kyc_face_jobs.result`,
 *                 puis les contrôles `id_portrait_extraction` / `face_match`
 *                 réenregistrés comme nouvelle tentative.
 *
 * Invariants :
 *   - aucun descripteur biométrique n'est persisté : les vecteurs 128D sont
 *     calculés en mémoire et détruits avec le processus ;
 *   - aucune image, aucun octet, aucun descripteur ne sort de
 *     l'infrastructure : aucun appel réseau sortant hors du stockage Moonyp ;
 *   - un travail non exécutable (poids absents, image illisible, visage
 *     inexploitable) devient `error` ou produit un résultat INCONCLUSIVE ;
 *     jamais un PASS ;
 *   - les journaux ne contiennent que des identifiants et des métriques,
 *     jamais de données biométriques.
 */

import {
  CONTROL_BY_KEY,
  type ControlKey,
  type ControlResult,
  type ControlStatus,
  type StepKey,
  sanitizeResult,
} from "./controls";
import { audit, db, ensureSession, recordStep, type SessionRow } from "./persistence.server";
import { readSession } from "./orchestrator.server";
import type { FaceMatchResult, FacePortraitResult } from "./engine.server";

export type FaceJobKind = "id_portrait" | "live_portrait" | "face_match";

export interface FaceJobRow {
  id: string;
  application_id: string;
  session_id: string | null;
  kind: FaceJobKind;
  step_key: StepKey;
  id_portrait_path: string | null;
  live_path: string | null;
  attempts: number;
}

export interface FaceJobOutcome {
  job_id: string;
  kind: FaceJobKind;
  status: "done" | "error";
  /** Métriques non biométriques, sûres à journaliser. */
  summary: Record<string, unknown>;
  error?: string;
  controls_recorded?: ControlKey[];
}

const BUCKET = "kyc-documents";

/* --------------------------------------------------------------------- */
/* File d'attente                                                         */
/* --------------------------------------------------------------------- */

/** Travaux en attente, du plus ancien au plus récent. */
export async function pendingFaceJobs(limit = 5): Promise<FaceJobRow[]> {
  const client = await db();
  const res = (await client
    .from("application_kyc_face_jobs")
    .select("id, application_id, session_id, kind, step_key, id_portrait_path, live_path, attempts")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit)) as { data: FaceJobRow[] | null; error: { message: string } | null };
  if (res.error) throw new Error(res.error.message);
  return res.data ?? [];
}

/**
 * Réserve un travail : la mise à jour est conditionnée au statut `pending`,
 * ce qui empêche deux workers de traiter le même travail.
 */
async function claim(job: FaceJobRow): Promise<boolean> {
  const client = await db();
  const res = (await client
    .from("application_kyc_face_jobs")
    .update({
      status: "running",
      attempts: job.attempts + 1,
      locked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id)
    .eq("status", "pending")
    .select("id")) as { data: { id: string }[] | null; error: { message: string } | null };
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []).length === 1;
}

async function finish(
  job: FaceJobRow,
  patch: {
    status: "done" | "error";
    result?: Record<string, unknown> | null;
    error?: string | null;
    engine?: string;
    engine_version?: string;
  },
): Promise<void> {
  const client = await db();
  const res = (await client
    .from("application_kyc_face_jobs")
    .update({
      status: patch.status,
      result: patch.result ?? null,
      error: patch.error ?? null,
      engine: patch.engine ?? null,
      engine_version: patch.engine_version ?? null,
      processed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id)) as unknown as { error: { message: string } | null };
  if (res.error) throw new Error(res.error.message);
}

async function downloadBytes(path: string): Promise<Uint8Array> {
  const client = await db();
  const res = await client.storage.from(BUCKET).download(path);
  if (res.error || !res.data)
    throw new Error(`storage_download_failed:${res.error?.message ?? "no_data"}`);
  return new Uint8Array(await res.data.arrayBuffer());
}

/* --------------------------------------------------------------------- */
/* Exécution d'un travail                                                 */
/* --------------------------------------------------------------------- */

function portraitResult(
  analysis: Awaited<ReturnType<typeof import("./face-engine.node").analyzeFaces>>,
  engine: { library: string; library_version: string },
  at: Date,
): FacePortraitResult {
  const primary = analysis.primary ?? analysis.faces[0] ?? null;
  const reasons: string[] = [];
  if (analysis.faces.length === 0) reasons.push("no_face_detected");
  if (analysis.faces.length > 1) reasons.push(`multiple_faces_detected:${analysis.faces.length}`);
  if (primary && !primary.quality.usable) reasons.push(...primary.quality.reasons);
  return {
    faces: analysis.faces.length,
    quality: {
      width: primary?.quality.width ?? 0,
      area_ratio: primary?.quality.area_ratio ?? 0,
      detection_score: primary?.quality.detection_score ?? 0,
      sharpness: primary?.quality.sharpness ?? 0,
      brightness: primary?.quality.brightness ?? 0,
    },
    usable: Boolean(analysis.primary) && analysis.faces.length === 1,
    reasons,
    engine: engine.library,
    engine_version: engine.library_version,
    computed_at: at.toISOString(),
  };
}

/**
 * Exécute un travail facial de bout en bout puis réenregistre les contrôles
 * dépendants. Les erreurs sont capturées et écrites sur le travail : le
 * worker ne s'arrête jamais sur un dossier.
 */
export async function processFaceJob(job: FaceJobRow): Promise<FaceJobOutcome> {
  const engineModule = await import("./face-engine.node");
  const { FACE_ENGINE, analyzeFaces, compareFaces, modelsAvailable, modelsDirectory } =
    engineModule;

  if (!(await claim(job))) {
    return {
      job_id: job.id,
      kind: job.kind,
      status: "error",
      summary: { skipped: "already_claimed" },
      error: "already_claimed",
    };
  }

  if (!modelsAvailable()) {
    const error = `face_models_missing:${modelsDirectory()}`;
    await finish(job, {
      status: "error",
      error,
      engine: FACE_ENGINE.library,
      engine_version: FACE_ENGINE.library_version,
    });
    await audit({
      application_id: job.application_id,
      session_id: job.session_id,
      event_type: "kyc_face_job_error",
      step_key: job.step_key,
      payload: { job_id: job.id, kind: job.kind, error },
    });
    return {
      job_id: job.id,
      kind: job.kind,
      status: "error",
      summary: { models: "missing" },
      error,
    };
  }

  const at = new Date();
  try {
    if (job.kind === "face_match") {
      if (!job.id_portrait_path || !job.live_path) throw new Error("face_match_paths_missing");
      const [idBytes, liveBytes] = await Promise.all([
        downloadBytes(job.id_portrait_path),
        downloadBytes(job.live_path),
      ]);
      const idAnalysis = await analyzeFaces(idBytes);
      const liveAnalysis = await analyzeFaces(liveBytes);
      const idFace = idAnalysis.primary;
      const liveFace = liveAnalysis.primary;
      const outcome = compareFaces(
        idFace ? { descriptor: idFace.descriptor, quality: idFace.quality } : null,
        liveFace ? { descriptor: liveFace.descriptor, quality: liveFace.quality } : null,
        at,
      );
      const stored: FaceMatchResult = {
        status: outcome.status,
        distance: outcome.distance,
        threshold: outcome.threshold,
        reasons: outcome.reasons,
        engine: outcome.library,
        engine_version: outcome.library_version,
        computed_at: outcome.evaluated_at,
      };
      await finish(job, {
        status: "done",
        result: stored as unknown as Record<string, unknown>,
        engine: FACE_ENGINE.library,
        engine_version: FACE_ENGINE.library_version,
      });
      await audit({
        application_id: job.application_id,
        session_id: job.session_id,
        event_type: "kyc_face_job_done",
        step_key: job.step_key,
        control_key: "face_match",
        status: stored.status,
        payload: {
          job_id: job.id,
          kind: job.kind,
          distance: stored.distance,
          threshold: stored.threshold,
          reasons: stored.reasons,
          id_faces: idAnalysis.faces.length,
          live_faces: liveAnalysis.faces.length,
        },
      });
      const controls = await recomputeFaceControls(job, { faceMatch: stored });
      return {
        job_id: job.id,
        kind: job.kind,
        status: "done",
        summary: { face_match: stored.status, distance: stored.distance, reasons: stored.reasons },
        controls_recorded: controls,
      };
    }

    const path = job.kind === "id_portrait" ? job.id_portrait_path : job.live_path;
    if (!path) throw new Error("portrait_path_missing");
    const analysis = await analyzeFaces(await downloadBytes(path));
    const stored = portraitResult(analysis, FACE_ENGINE, at);
    await finish(job, {
      status: "done",
      result: stored as unknown as Record<string, unknown>,
      engine: FACE_ENGINE.library,
      engine_version: FACE_ENGINE.library_version,
    });
    await audit({
      application_id: job.application_id,
      session_id: job.session_id,
      event_type: "kyc_face_job_done",
      step_key: job.step_key,
      control_key: job.kind === "id_portrait" ? "id_portrait_extraction" : null,
      status: stored.usable ? "usable" : "not_usable",
      payload: {
        job_id: job.id,
        kind: job.kind,
        faces: stored.faces,
        usable: stored.usable,
        reasons: stored.reasons,
      },
    });
    const controls =
      job.kind === "id_portrait" ? await recomputeFaceControls(job, { portrait: stored }) : [];
    return {
      job_id: job.id,
      kind: job.kind,
      status: "done",
      summary: { faces: stored.faces, usable: stored.usable, reasons: stored.reasons },
      controls_recorded: controls,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : "face_job_failed";
    await finish(job, { status: "error", error });
    await audit({
      application_id: job.application_id,
      session_id: job.session_id,
      event_type: "kyc_face_job_error",
      step_key: job.step_key,
      payload: { job_id: job.id, kind: job.kind, error },
    });
    return { job_id: job.id, kind: job.kind, status: "error", summary: {}, error };
  }
}

/* --------------------------------------------------------------------- */
/* Réenregistrement des contrôles dépendants                              */
/* --------------------------------------------------------------------- */

interface StoredControlRow {
  control_key: string;
  step_key: StepKey;
  status: ControlStatus;
  executed: boolean;
  attempt: number;
  method: string | null;
  library: string | null;
  library_version: string | null;
  score: number | null;
  threshold: number | null;
  reasons: string[];
  details: Record<string, unknown>;
}

function toControlResult(row: StoredControlRow): ControlResult {
  return {
    control: row.control_key as ControlKey,
    status: row.status,
    executed: row.executed,
    method: row.method ?? "not_executed",
    library: row.library ?? undefined,
    library_version: row.library_version ?? undefined,
    score: row.score ?? undefined,
    threshold: row.threshold ?? undefined,
    reasons: row.reasons ?? [],
    details: row.details ?? {},
  };
}

/**
 * Réécrit l'étape concernée avec le contrôle facial réellement calculé.
 *
 * Les autres contrôles de l'étape sont reportés **tels qu'ils ont été
 * mesurés** lors de la dernière tentative : rien n'est recalculé sans
 * données, rien n'est promu. Si l'étape n'a jamais été enregistrée, aucun
 * contrôle n'est écrit — le résultat facial reste disponible dans la file et
 * sera pris en compte à la prochaine soumission.
 */
export async function recomputeFaceControls(
  job: FaceJobRow,
  computed: { portrait?: FacePortraitResult; faceMatch?: FaceMatchResult },
): Promise<ControlKey[]> {
  const client = await db();
  const session: SessionRow = await ensureSession(job.application_id, null);
  const step = job.step_key;
  const targetControl: ControlKey = computed.faceMatch ? "face_match" : "id_portrait_extraction";

  const res = (await client
    .from("application_kyc_controls")
    .select(
      "control_key, step_key, status, executed, attempt, method, library, library_version, score, threshold, reasons, details",
    )
    .eq("session_id", session.id)
    .eq("step_key", step)
    .order("attempt", { ascending: true })) as {
    data: StoredControlRow[] | null;
    error: { message: string } | null;
  };
  if (res.error) throw new Error(res.error.message);
  const rows = res.data ?? [];
  if (rows.length === 0) return [];

  // Dernière tentative connue de l'étape.
  const lastAttempt = Math.max(...rows.map((r) => r.attempt));
  const latest = rows.filter((r) => r.attempt === lastAttempt);

  const merged = new Map<ControlKey, ControlResult>();
  for (const row of latest) merged.set(row.control_key as ControlKey, toControlResult(row));

  if (computed.faceMatch) {
    const m = computed.faceMatch;
    merged.set("face_match", {
      control: "face_match",
      status: m.status,
      executed: true,
      method: "face_descriptor_euclidean_distance",
      library: m.engine,
      library_version: m.engine_version,
      score: m.distance !== null ? Math.round((1 - Math.min(m.distance, 1)) * 100) : undefined,
      threshold: Math.round((1 - m.threshold) * 100),
      reasons: [...m.reasons, "recomputed_by_face_worker"],
      details: {
        distance: m.distance,
        distance_threshold: m.threshold,
        computed_at: m.computed_at,
        job_id: job.id,
      },
    });
  }
  if (computed.portrait) {
    const p = computed.portrait;
    const status: ControlStatus = p.usable ? "PASS" : p.faces === 0 ? "FAIL" : "INCONCLUSIVE";
    merged.set("id_portrait_extraction", {
      control: "id_portrait_extraction",
      status,
      executed: true,
      method: "face_detection_ssd_mobilenetv1",
      library: p.engine,
      library_version: p.engine_version,
      score: Math.round(p.quality.detection_score * 100),
      threshold: 60,
      reasons: [...p.reasons, "recomputed_by_face_worker"],
      details: { faces: p.faces, quality: p.quality, computed_at: p.computed_at, job_id: job.id },
    });
  }

  const results = [...merged.values()].map(sanitizeResult);
  // Garde-fou : le contrôle visé doit être présent et exécuté.
  const target = results.find((r) => r.control === targetControl);
  if (!target || !target.executed) return [];
  if (CONTROL_BY_KEY[targetControl].unverifiable) return [];

  const view = await readSession(job.application_id, session.language);
  await recordStep({
    applicationId: job.application_id,
    session,
    step,
    results,
    documentIds: [],
    documentTypeSlug: null,
    durationMs: 0,
    requiredSteps: view.required_steps,
  });
  await audit({
    application_id: job.application_id,
    session_id: session.id,
    event_type: "kyc_face_controls_recomputed",
    step_key: step,
    control_key: targetControl,
    status: target.status,
    payload: {
      job_id: job.id,
      controls: results.map((r) => ({ control: r.control, status: r.status })),
    },
  });
  return results.map((r) => r.control);
}

/** Traite au plus `limit` travaux en attente. */
export async function processPendingFaceJobs(limit = 5): Promise<FaceJobOutcome[]> {
  const jobs = await pendingFaceJobs(limit);
  const out: FaceJobOutcome[] = [];
  for (const job of jobs) out.push(await processFaceJob(job));
  return out;
}
