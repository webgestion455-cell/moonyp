/**
 * Orchestration serveur du parcours KYC.
 *
 * Point d'entrée unique du moteur : collecte les entrées réelles (octets du
 * fichier déposé dans le bucket privé, signature binaire, empreinte SHA-256,
 * texte serveur pour les PDF, preuve de capture, listes de screening, résultats
 * du moteur facial), exécute les contrôles de l'étape, puis persiste
 * contrôles + étape + audit.
 *
 * Aucune donnée ne sort de l'infrastructure : lecture du stockage privé Moonyp,
 * calcul local, écriture en base Moonyp. Aucun appel à un fournisseur KYC.
 */

import {
  STEP_DOCUMENT_CATEGORY,
  STEP_ORDER,
  canSubmitStep,
  type ControlResult,
  type StepKey,
  type StepStatus,
} from "./controls";
import { sha256Hex, sniffFile } from "./file-sniff";
import { extractDocumentText } from "./text-source.server";
import {
  engineContext,
  runStep,
  type AnalysedFile,
  type FaceMatchResult,
  type FacePortraitResult,
  type SubjectData,
} from "./engine.server";
import {
  audit,
  db,
  enqueueFaceJob,
  ensureSession,
  loadControls,
  loadFaceResults,
  loadScreeningList,
  loadStepStatuses,
  recordBiometricAsset,
  recordStep,
  type SessionRow,
} from "./persistence.server";
import type { RiskFacts } from "./fraud";

const BUCKET = "kyc-documents";

export interface SubmittedFile {
  document_type_slug: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  capture_evidence?: unknown;
  /** Texte lu par le navigateur (images uniquement) — source non authentifiée. */
  ocr_text?: string | null;
}

/* --------------------------------------------------------------------- */
/* Plan documentaire du dossier                                           */
/* --------------------------------------------------------------------- */

export interface ApplicationSubject extends SubjectData {
  id: string;
  employment_status: string | null;
  country: string | null;
  product_slug: string | null;
}

/**
 * Colonnes réellement présentes dans `public.loan_applications` :
 * les coordonnées bancaires du dossier sont stockées dans `bank_iban`
 * (et non `iban`, qui n'existe pas), et le produit est référencé par
 * `product_id` -> `loan_products.slug` (il n'y a pas de colonne
 * `product_slug` sur le dossier). La jointure PostgREST est explicite pour
 * éviter toute ambiguïté de relation.
 */
export async function loadSubject(applicationId: string): Promise<ApplicationSubject> {
  const client = await db();
  const res = (await client
    .from("loan_applications")
    .select(
      "id, first_name, last_name, birth_date, nationality, address, postal_code, city, bank_iban, monthly_income, employment_status, country, product_id, loan_products:product_id(slug)",
    )
    .eq("id", applicationId)
    .maybeSingle()) as { data: Record<string, unknown> | null; error: { message: string } | null };
  if (res.error) throw new Error(res.error.message);
  if (!res.data) throw new Error("application_not_found");
  const row = res.data;
  const str = (k: string) => (typeof row[k] === "string" ? (row[k] as string) : null);

  // PostgREST renvoie l'objet lié (ou un tableau selon la cardinalité déduite).
  const productRel = row["loan_products"];
  const productRow = Array.isArray(productRel)
    ? ((productRel[0] ?? null) as Record<string, unknown> | null)
    : ((productRel ?? null) as Record<string, unknown> | null);
  const productSlug =
    productRow && typeof productRow["slug"] === "string" ? (productRow["slug"] as string) : null;

  return {
    id: applicationId,
    first_name: str("first_name"),
    last_name: str("last_name"),
    birth_date: str("birth_date"),
    nationality: str("nationality"),
    address: str("address"),
    postal_code: str("postal_code"),
    city: str("city"),
    // Source réelle : loan_applications.bank_iban (étape « coordonnées de versement »).
    iban: str("bank_iban"),
    monthly_income:
      row["monthly_income"] !== null && row["monthly_income"] !== undefined
        ? Number(row["monthly_income"])
        : null,
    employment_status: str("employment_status"),
    country: str("country"),
    product_slug: productSlug,
  };
}

/** Étapes réellement exigées par le catalogue pour ce dossier. */
export async function loadRequiredSteps(subject: ApplicationSubject): Promise<{
  steps: StepKey[];
  slugsByStep: Record<string, string[]>;
}> {
  const client = await db();
  const res = (await client
    .from("document_types")
    .select("slug, category, required, employment_statuses, countries, product_slugs")
    .eq("active", true)
    .order("sort_order", { ascending: true })) as {
    data:
      | {
          slug: string;
          category: string;
          required: boolean;
          employment_statuses: string[] | null;
          countries: string[] | null;
          product_slugs: string[] | null;
        }[]
      | null;
    error: { message: string } | null;
  };
  if (res.error) throw new Error(res.error.message);

  const applies = (t: {
    employment_statuses: string[] | null;
    countries: string[] | null;
    product_slugs: string[] | null;
  }) => {
    const ok = (list: string[] | null, value: string | null) =>
      !list || list.length === 0 || (value !== null && list.includes(value));
    return (
      ok(t.employment_statuses, subject.employment_status) &&
      ok(t.countries, subject.country) &&
      ok(t.product_slugs, subject.product_slug)
    );
  };

  const slugsByStep: Record<string, string[]> = {};
  const steps: StepKey[] = [];
  for (const step of STEP_ORDER) {
    const category = STEP_DOCUMENT_CATEGORY[step];
    const matching = (res.data ?? []).filter((t) => t.category === category && applies(t));
    slugsByStep[step] = matching.map((t) => t.slug);
    if (matching.some((t) => t.required)) steps.push(step);
  }
  // La vivacité et l'identité sont structurantes : elles restent exigées même
  // si le catalogue n'impose pas de pièce dédiée pour le selfie.
  for (const mandatory of ["identity", "liveness"] as StepKey[]) {
    if (!steps.includes(mandatory)) steps.push(mandatory);
  }
  return { steps: STEP_ORDER.filter((s) => steps.includes(s)), slugsByStep };
}

/* --------------------------------------------------------------------- */
/* Analyse réelle d'un fichier déposé                                     */
/* --------------------------------------------------------------------- */

export async function analyseStoredFile(file: SubmittedFile): Promise<AnalysedFile> {
  const client = await db();
  const { data, error } = await client.storage.from(BUCKET).download(file.storage_path);
  if (error || !data) throw new Error(`storage_download_failed:${file.storage_path}`);
  const bytes = new Uint8Array(await data.arrayBuffer());

  const sniff = sniffFile(bytes, file.mime_type, file.file_size);
  const sha256 = await sha256Hex(bytes);
  const text = sniff.accepted
    ? await extractDocumentText(bytes, sniff.kind, file.ocr_text ?? null)
    : {
        text: "",
        source: "none" as const,
        server_side: false,
        engine: null,
        reasons: ["file_rejected_before_text_extraction"],
      };

  return {
    slug: file.document_type_slug,
    storage_path: file.storage_path,
    file_name: file.file_name,
    declared_mime: file.mime_type,
    declared_size: file.file_size,
    sha256,
    sniff,
    text,
    capture_evidence: file.capture_evidence,
  };
}

/* --------------------------------------------------------------------- */
/* Faits de risque réels                                                  */
/* --------------------------------------------------------------------- */

async function buildRiskFacts(
  applicationId: string,
  hashes: string[],
  sessionId: string,
): Promise<RiskFacts> {
  const client = await db();
  const [known, uploads, liveness] = await Promise.all([
    client
      .from("application_documents")
      .select("sha256, application_id")
      .in("sha256", hashes.length ? hashes : ["-"])
      .limit(200) as unknown as Promise<{
      data: { sha256: string | null; application_id: string }[] | null;
    }>,
    client
      .from("application_documents")
      .select("id", { count: "exact", head: true })
      .eq("application_id", applicationId) as unknown as Promise<{ count: number | null }>,
    client
      .from("application_kyc_steps")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessionId)
      .eq("step_key", "liveness") as unknown as Promise<{ count: number | null }>,
  ]);

  const duplicates = hashes.length - new Set(hashes).size;
  return {
    file_hashes: hashes,
    known_hashes: (known.data ?? [])
      .filter((d) => typeof d.sha256 === "string")
      .map((d) => ({ hash: d.sha256 as string, application_id: d.application_id })),
    upload_attempts: uploads.count ?? 0,
    liveness_attempts: liveness.count ?? 0,
    faces_detected: null,
    screen_presentation_suspected: false,
    future_dated_documents: [],
    duplicate_within_application: duplicates,
    identity_document_expired: null,
    application_id: applicationId,
  };
}

/* --------------------------------------------------------------------- */
/* Exécution d'une étape                                                  */
/* --------------------------------------------------------------------- */

export interface ProcessStepInput {
  applicationId: string;
  step: StepKey;
  files: SubmittedFile[];
  language: string | null;
  /** Preuve de vivacité mesurée par le navigateur (étape `liveness`). */
  livenessEvidence?: unknown;
  /** Images de la session de vivacité déjà déposées dans le bucket privé. */
  livenessFrames?: { storage_path: string; challenge?: string | null }[];
}

export interface ProcessStepResult {
  session_id: string;
  step: StepKey;
  status: StepStatus;
  attempt: number;
  aggregate: string;
  controls: { control: string; status: string; executed: boolean }[];
  next_step: StepKey | null;
}

export async function processStep(input: ProcessStepInput): Promise<ProcessStepResult> {
  const started = Date.now();
  const client = await db();
  const subject = await loadSubject(input.applicationId);
  const session = await ensureSession(input.applicationId, input.language);
  const { steps: requiredSteps } = await loadRequiredSteps(subject);

  const statuses = await loadStepStatuses(session.id);
  const stepMap: Partial<Record<StepKey, StepStatus>> = {};
  for (const [key, value] of Object.entries(statuses)) stepMap[key as StepKey] = value.status;

  const gate = canSubmitStep(input.step, stepMap, requiredSteps);
  if (!gate.allowed) {
    await audit({
      application_id: input.applicationId,
      session_id: session.id,
      event_type: "kyc_step_rejected",
      step_key: input.step,
      payload: { reason: gate.reason },
    });
    throw new Error(gate.reason ?? "step_not_allowed");
  }

  // Les chemins sont vérifiés côté serveur : un dossier ne peut jamais
  // référencer le fichier d'un autre dossier.
  const files = input.files.filter((f) => f.storage_path.startsWith(`${input.applicationId}/`));
  const analysed: AnalysedFile[] = [];
  for (const file of files) analysed.push(await analyseStoredFile(file));

  const ctx = engineContext(subject, new Date());
  const face = await loadFaceResults(input.applicationId);

  let results: ControlResult[];

  if (input.step === "identity") {
    const screening = await loadScreeningList();
    const riskFacts = await buildRiskFacts(
      input.applicationId,
      analysed.map((a) => a.sha256),
      session.id,
    );
    results = runStep({
      step: "identity",
      files: analysed,
      ctx,
      portrait: face.idPortrait as FacePortraitResult | null,
      screening,
      riskFacts,
    });
    // Le portrait n'est pas encore calculé : on met le travail en file pour le
    // moteur facial interne. Le contrôle reste NOT_VERIFIED d'ici là.
    if (!face.idPortrait && analysed[0]) {
      await recordBiometricAsset({
        application_id: input.applicationId,
        session_id: session.id,
        kind: "id_portrait",
        storage_path: analysed[0].storage_path,
      });
      await enqueueFaceJob({
        application_id: input.applicationId,
        session_id: session.id,
        kind: "id_portrait",
        step_key: "identity",
        id_portrait_path: analysed[0].storage_path,
      });
    }
  } else if (input.step === "liveness") {
    const frames = (input.livenessFrames ?? []).filter((f) =>
      f.storage_path.startsWith(`${input.applicationId}/`),
    );
    let sessionRef: {
      asset_id: string;
      frames: number;
      challenges: string[];
      recorded_at: string;
    } | null = null;
    if (frames.length > 0) {
      const assetId = await recordBiometricAsset({
        application_id: input.applicationId,
        session_id: session.id,
        kind: "liveness_portrait",
        storage_path: frames[0]!.storage_path,
      });
      for (const frame of frames.slice(1)) {
        await recordBiometricAsset({
          application_id: input.applicationId,
          session_id: session.id,
          kind: "challenge_frame",
          storage_path: frame.storage_path,
          challenge: frame.challenge ?? null,
        });
      }
      sessionRef = {
        asset_id: assetId,
        frames: frames.length,
        challenges: frames.map((f) => f.challenge ?? "").filter(Boolean),
        recorded_at: new Date().toISOString(),
      };
    }

    results = runStep({
      step: "liveness",
      files: analysed,
      ctx,
      faceMatch: face.match as FaceMatchResult | null,
      liveFace: face.livePortrait as FacePortraitResult | null,
      livenessEvidence: input.livenessEvidence,
      livenessSession: sessionRef,
    });

    // Face match : calculé par le moteur facial interne, jamais déduit de la
    // vivacité. Nécessite le portrait de la pièce ET une image de la session.
    if (!face.match && frames[0]) {
      const idPath = await findIdPortraitPath(input.applicationId);
      if (idPath) {
        await enqueueFaceJob({
          application_id: input.applicationId,
          session_id: session.id,
          kind: "face_match",
          step_key: "liveness",
          id_portrait_path: idPath,
          live_path: frames[0].storage_path,
        });
      }
    }
  } else {
    results = runStep({ step: input.step, files: analysed, ctx });
  }

  // Rattachement aux pièces déjà enregistrées (si le dépôt a déjà été fait).
  const docIds = await resolveDocumentIds(
    input.applicationId,
    analysed.map((a) => a.storage_path),
  );
  for (const r of results) {
    if (!r.document_id && analysed[0]) r.document_id = docIds[analysed[0].storage_path] ?? null;
  }

  // Empreinte et type réel mesurés côté serveur, écrits sur la pièce.
  for (const a of analysed) {
    const id = docIds[a.storage_path];
    if (!id) continue;
    await client
      .from("application_documents")
      .update({
        sha256: a.sha256,
        detected_mime: a.sniff.kind,
        server_analysis: {
          sniff: a.sniff,
          text_source: a.text.source,
          text_server_side: a.text.server_side,
          pages: a.text.pages ?? null,
          analysed_at: new Date().toISOString(),
        },
      })
      .eq("id", id);
  }

  const recorded = await recordStep({
    applicationId: input.applicationId,
    session,
    step: input.step,
    results,
    documentIds: Object.values(docIds),
    documentTypeSlug: analysed[0]?.slug ?? null,
    durationMs: Date.now() - started,
    requiredSteps,
  });

  const after = await loadStepStatuses(session.id);
  const afterMap: Partial<Record<StepKey, StepStatus>> = {};
  for (const [key, value] of Object.entries(after)) afterMap[key as StepKey] = value.status;

  return {
    session_id: session.id,
    step: input.step,
    status: recorded.step_status,
    attempt: recorded.attempt,
    aggregate: recorded.aggregate,
    controls: results.map((r) => ({ control: r.control, status: r.status, executed: r.executed })),
    next_step:
      requiredSteps.find((s) => {
        const st = afterMap[s] ?? "NOT_STARTED";
        return st === "NOT_STARTED" || st === "FAIL";
      }) ?? null,
  };
}

async function findIdPortraitPath(applicationId: string): Promise<string | null> {
  const client = await db();
  const res = (await client
    .from("application_kyc_biometric_assets")
    .select("storage_path")
    .eq("application_id", applicationId)
    .eq("kind", "id_portrait")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()) as { data: { storage_path: string } | null };
  return res.data?.storage_path ?? null;
}

async function resolveDocumentIds(
  applicationId: string,
  paths: string[],
): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const client = await db();
  const res = (await client
    .from("application_documents")
    .select("id, storage_path")
    .eq("application_id", applicationId)
    .in("storage_path", paths)) as { data: { id: string; storage_path: string }[] | null };
  const out: Record<string, string> = {};
  for (const row of res.data ?? []) out[row.storage_path] = row.id;
  return out;
}

/* --------------------------------------------------------------------- */
/* Lecture de l'état du parcours                                          */
/* --------------------------------------------------------------------- */

export interface SessionView {
  session_id: string;
  language: string | null;
  required_steps: StepKey[];
  steps: { step: StepKey; status: StepStatus; attempt: number; updated_at: string | null }[];
  current_step: StepKey | null;
  controls: Awaited<ReturnType<typeof loadControls>>;
  aggregate: string;
}

export async function readSession(
  applicationId: string,
  language: string | null,
): Promise<SessionView> {
  const subject = await loadSubject(applicationId);
  const session: SessionRow = await ensureSession(applicationId, language);
  const { steps: requiredSteps } = await loadRequiredSteps(subject);
  const statuses = await loadStepStatuses(session.id);
  const controls = await loadControls(session.id);

  const steps = requiredSteps.map((s) => ({
    step: s,
    status: (statuses[s]?.status ?? "NOT_STARTED") as StepStatus,
    attempt: statuses[s]?.attempt ?? 0,
    updated_at: statuses[s]?.updated_at ?? null,
  }));

  const { aggregateKyc } = await import("./controls");
  const map: Partial<Record<StepKey, StepStatus>> = {};
  for (const s of steps) map[s.step] = s.status;
  const aggregate = aggregateKyc({ steps: map, requiredSteps });

  return {
    session_id: session.id,
    language: session.language,
    required_steps: requiredSteps,
    steps,
    current_step:
      steps.find((s) => s.status === "NOT_STARTED" || s.status === "FAIL")?.step ?? null,
    controls,
    aggregate: aggregate.state,
  };
}
