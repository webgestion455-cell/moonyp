/**
 * Persistance du moteur KYC — sessions, étapes, contrôles, audit.
 *
 * Toutes les écritures passent par le `service_role` côté serveur : le
 * navigateur n'écrit jamais un statut de contrôle. Les tables concernées sont
 * protégées par RLS et inaccessibles depuis le client.
 *
 * Invariants respectés ici :
 *   - une ligne par contrôle et par tentative (`attempt`), jamais d'écrasement ;
 *   - le résultat machine est figé par trigger : on insère, on ne met jamais
 *     à jour un résultat déjà écrit ;
 *   - chaque écriture produit un événement d'audit append-only ;
 *   - la biométrie n'est référencée que par son chemin de stockage privé,
 *     avec une échéance de suppression.
 */

import {
  KYC_ENGINE_VERSION,
  aggregateKyc,
  type ControlResult,
  type KycAggregateState,
  type StepKey,
  type StepStatus,
  sanitizeResult,
  stepStatus,
} from "./controls";

/* Le schéma généré ne contient pas encore ces tables : on s'appuie sur un
 * accès non typé volontairement localisé dans ce module, jamais ailleurs. */
type AnyBuilder = Record<string, (...args: unknown[]) => AnyBuilder> & PromiseLike<{ data: unknown; error: { message: string } | null }>;
interface UntypedClient {
  from(table: string): AnyBuilder;
  storage: {
    from(bucket: string): {
      download(path: string): Promise<{ data: Blob | null; error: { message: string } | null }>;
      createSignedUrl(path: string, expiresIn: number): Promise<{ data: { signedUrl: string } | null; error: unknown }>;
      remove(paths: string[]): Promise<{ error: unknown }>;
    };
  };
}

export async function db(): Promise<UntypedClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as UntypedClient;
}

export interface SessionRow {
  id: string;
  application_id: string;
  status: string;
  language: string | null;
  current_step: StepKey | null;
  engine_version: string;
}

/** Session ouverte du dossier, créée si nécessaire. */
export async function ensureSession(applicationId: string, language: string | null): Promise<SessionRow> {
  const client = await db();
  const existing = (await client
    .from("application_kyc_sessions")
    .select("id, application_id, status, language, current_step, engine_version")
    .eq("application_id", applicationId)
    .eq("status", "in_progress")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()) as { data: SessionRow | null; error: { message: string } | null };
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) return existing.data;

  const created = (await client
    .from("application_kyc_sessions")
    .insert({
      application_id: applicationId,
      status: "in_progress",
      engine_version: KYC_ENGINE_VERSION,
      language,
      current_step: "identity",
    })
    .select("id, application_id, status, language, current_step, engine_version")
    .single()) as { data: SessionRow | null; error: { message: string } | null };
  if (created.error || !created.data) throw new Error(created.error?.message ?? "session_not_created");

  await audit({
    application_id: applicationId,
    session_id: created.data.id,
    event_type: "kyc_session_started",
    payload: { language },
  });
  return created.data;
}

/** Statut courant de chaque étape (dernière tentative enregistrée). */
export async function loadStepStatuses(sessionId: string): Promise<Record<string, { status: StepStatus; attempt: number; updated_at: string }>> {
  const client = await db();
  const res = (await client
    .from("application_kyc_steps")
    .select("step_key, status, attempt, updated_at")
    .eq("session_id", sessionId)
    .order("attempt", { ascending: true })) as {
    data: { step_key: StepKey; status: StepStatus; attempt: number; updated_at: string }[] | null;
    error: { message: string } | null;
  };
  if (res.error) throw new Error(res.error.message);
  const out: Record<string, { status: StepStatus; attempt: number; updated_at: string }> = {};
  for (const row of res.data ?? []) out[row.step_key] = { status: row.status, attempt: row.attempt, updated_at: row.updated_at };
  return out;
}

export async function loadControls(sessionId: string): Promise<
  {
    control_key: string;
    step_key: StepKey;
    status: string;
    executed: boolean;
    attempt: number;
    method: string | null;
    library: string | null;
    library_version: string | null;
    score: number | null;
    threshold: number | null;
    reasons: string[];
    details: Record<string, unknown>;
    created_at: string;
  }[]
> {
  const client = await db();
  const res = (await client
    .from("application_kyc_controls")
    .select(
      "control_key, step_key, status, executed, attempt, method, library, library_version, score, threshold, reasons, details, created_at",
    )
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })) as { data: never[] | null; error: { message: string } | null };
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as never;
}

export interface RecordStepInput {
  applicationId: string;
  session: SessionRow;
  step: StepKey;
  results: ControlResult[];
  documentIds: string[];
  documentTypeSlug: string | null;
  durationMs: number;
  requiredSteps: readonly StepKey[];
}

export interface RecordStepOutput {
  step_status: StepStatus;
  attempt: number;
  aggregate: KycAggregateState;
}

/** Écrit une tentative d'étape : contrôles, statut d'étape, audit, agrégat. */
export async function recordStep(input: RecordStepInput): Promise<RecordStepOutput> {
  const client = await db();
  const results = input.results.map(sanitizeResult);
  const { status, reasons } = stepStatus(input.step, results);

  const previous = (await client
    .from("application_kyc_steps")
    .select("attempt")
    .eq("session_id", input.session.id)
    .eq("step_key", input.step)
    .order("attempt", { ascending: false })
    .limit(1)
    .maybeSingle()) as { data: { attempt: number } | null; error: { message: string } | null };
  if (previous.error) throw new Error(previous.error.message);
  const attempt = (previous.data?.attempt ?? 0) + 1;

  const stepInsert = (await client
    .from("application_kyc_steps")
    .insert({
      session_id: input.session.id,
      application_id: input.applicationId,
      step_key: input.step,
      attempt,
      status,
      reasons: reasons.slice(0, 80),
      document_ids: input.documentIds,
      document_type_slug: input.documentTypeSlug,
      completed_at: new Date().toISOString(),
      duration_ms: Math.round(input.durationMs),
    })
    .select("id")
    .single()) as { data: { id: string } | null; error: { message: string } | null };
  if (stepInsert.error || !stepInsert.data) throw new Error(stepInsert.error?.message ?? "step_not_recorded");

  const rows = results.map((r) => ({
    session_id: input.session.id,
    step_id: stepInsert.data!.id,
    application_id: input.applicationId,
    step_key: input.step,
    control_key: r.control,
    attempt,
    status: r.status,
    executed: r.executed,
    method: r.method,
    library: r.library ?? null,
    library_version: r.library_version ?? null,
    engine_version: KYC_ENGINE_VERSION,
    score: r.score ?? null,
    threshold: r.threshold ?? null,
    reasons: r.reasons.slice(0, 40),
    details: r.details ?? {},
    document_id: r.document_id ?? null,
    duration_ms: r.duration_ms ?? null,
  }));
  const controlInsert = (await client.from("application_kyc_controls").insert(rows)) as unknown as {
    error: { message: string } | null;
  };
  if (controlInsert.error) throw new Error(controlInsert.error.message);

  await audit({
    application_id: input.applicationId,
    session_id: input.session.id,
    event_type: "kyc_step_recorded",
    step_key: input.step,
    status,
    payload: {
      attempt,
      controls: results.map((r) => ({ control: r.control, status: r.status, executed: r.executed, reasons: r.reasons })),
      document_ids: input.documentIds,
      duration_ms: Math.round(input.durationMs),
    },
  });

  const statuses = await loadStepStatuses(input.session.id);
  const steps: Partial<Record<StepKey, StepStatus>> = {};
  for (const [key, value] of Object.entries(statuses)) steps[key as StepKey] = value.status;
  const aggregate = aggregateKyc({ steps, requiredSteps: input.requiredSteps });

  await client
    .from("loan_applications")
    .update({ kyc_state: aggregate.state })
    .eq("id", input.applicationId);

  await client
    .from("application_kyc_sessions")
    .update({ current_step: nextIncomplete(steps, input.requiredSteps), updated_at: new Date().toISOString() })
    .eq("id", input.session.id);

  await audit({
    application_id: input.applicationId,
    session_id: input.session.id,
    event_type: "kyc_state_updated",
    status: aggregate.state,
    payload: { reasons: aggregate.reasons, steps },
  });

  return { step_status: status, attempt, aggregate: aggregate.state };
}

function nextIncomplete(steps: Partial<Record<StepKey, StepStatus>>, required: readonly StepKey[]): StepKey | null {
  for (const key of required) {
    const s = steps[key] ?? "NOT_STARTED";
    if (s === "NOT_STARTED" || s === "FAIL") return key;
  }
  return null;
}

/** Journal append-only : aucune modification ni suppression n'est possible. */
export async function audit(entry: {
  application_id: string;
  session_id?: string | null;
  event_type: string;
  step_key?: string | null;
  control_key?: string | null;
  status?: string | null;
  actor_type?: "applicant" | "system" | "staff";
  actor_id?: string | null;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const client = await db();
  const res = (await client.from("application_kyc_audit_events").insert({
    application_id: entry.application_id,
    session_id: entry.session_id ?? null,
    event_type: entry.event_type,
    step_key: entry.step_key ?? null,
    control_key: entry.control_key ?? null,
    status: entry.status ?? null,
    actor_type: entry.actor_type ?? "system",
    actor_id: entry.actor_id ?? null,
    engine_version: KYC_ENGINE_VERSION,
    payload: entry.payload ?? {},
  })) as unknown as { error: { message: string } | null };
  if (res.error) throw new Error(res.error.message);
}

/** Référence biométrique (jamais l'image elle-même en base). */
export async function recordBiometricAsset(input: {
  application_id: string;
  session_id: string;
  kind: "id_portrait" | "liveness_portrait" | "challenge_frame";
  storage_path: string;
  challenge?: string | null;
}): Promise<string> {
  const client = await db();
  const res = (await client
    .from("application_kyc_biometric_assets")
    .insert({
      application_id: input.application_id,
      session_id: input.session_id,
      kind: input.kind,
      storage_path: input.storage_path,
      challenge: input.challenge ?? null,
    })
    .select("id")
    .single()) as { data: { id: string } | null; error: { message: string } | null };
  if (res.error || !res.data) throw new Error(res.error?.message ?? "biometric_asset_not_recorded");
  return res.data.id;
}

/** Liste de screening active la plus récente, avec ses entrées. */
export async function loadScreeningList(): Promise<{
  list: { version: string | null; source: string | null; imported_at: string | null; entry_count: number } | null;
  entries: {
    id: string;
    full_name: string;
    aliases?: string[];
    birth_date?: string | null;
    nationality?: string | null;
    kind: "sanction" | "pep";
    program?: string | null;
  }[];
}> {
  const client = await db();
  const lists = (await client
    .from("kyc_screening_lists")
    .select("id, source, list_kind, version, imported_at, entry_count")
    .eq("active", true)
    .order("imported_at", { ascending: false })
    .limit(4)) as {
    data: { id: string; source: string; list_kind: "sanctions" | "pep"; version: string; imported_at: string; entry_count: number }[] | null;
    error: { message: string } | null;
  };
  if (lists.error) throw new Error(lists.error.message);
  if (!lists.data || lists.data.length === 0) return { list: null, entries: [] };

  const ids = lists.data.map((l) => l.id);
  const entries = (await client
    .from("kyc_screening_entries")
    .select("id, list_id, primary_name, names, birth_dates, nationalities, programs")
    .in("list_id", ids)
    .limit(50_000)) as {
    data: { id: string; list_id: string; primary_name: string; names: string[]; birth_dates: string[]; nationalities: string[]; programs: string[] }[] | null;
    error: { message: string } | null;
  };
  if (entries.error) throw new Error(entries.error.message);

  const kindByList = new Map(lists.data.map((l) => [l.id, l.list_kind === "pep" ? ("pep" as const) : ("sanction" as const)]));
  const head = lists.data[0]!;
  return {
    list: {
      version: head.version,
      source: lists.data.map((l) => `${l.source}@${l.version}`).join(","),
      imported_at: head.imported_at,
      entry_count: lists.data.reduce((sum, l) => sum + (l.entry_count ?? 0), 0),
    },
    entries: (entries.data ?? []).map((e) => ({
      id: e.id,
      full_name: e.primary_name,
      aliases: e.names ?? [],
      birth_date: e.birth_dates?.[0] ?? null,
      nationality: e.nationalities?.[0] ?? null,
      kind: kindByList.get(e.list_id) ?? "sanction",
      program: e.programs?.[0] ?? null,
    })),
  };
}

/** Met en file un travail du moteur facial (exécuté par le worker interne). */
export async function enqueueFaceJob(input: {
  application_id: string;
  session_id: string;
  kind: "id_portrait" | "live_portrait" | "face_match";
  step_key: StepKey;
  id_portrait_path?: string | null;
  live_path?: string | null;
}): Promise<string | null> {
  const client = await db();
  const res = (await client
    .from("application_kyc_face_jobs")
    .insert({
      application_id: input.application_id,
      session_id: input.session_id,
      kind: input.kind,
      step_key: input.step_key,
      id_portrait_path: input.id_portrait_path ?? null,
      live_path: input.live_path ?? null,
    })
    .select("id")
    .single()) as { data: { id: string } | null; error: { message: string } | null };
  if (res.error) return null;
  return res.data?.id ?? null;
}

/** Dernier résultat facial exploitable pour un dossier. */
export async function loadFaceResults(applicationId: string): Promise<{
  idPortrait: Record<string, unknown> | null;
  livePortrait: Record<string, unknown> | null;
  match: Record<string, unknown> | null;
}> {
  const client = await db();
  const res = (await client
    .from("application_kyc_face_jobs")
    .select("kind, status, result, processed_at")
    .eq("application_id", applicationId)
    .eq("status", "done")
    .order("processed_at", { ascending: false })
    .limit(20)) as {
    data: { kind: string; result: Record<string, unknown> | null }[] | null;
    error: { message: string } | null;
  };
  if (res.error) return { idPortrait: null, livePortrait: null, match: null };
  const pick = (kind: string) => res.data?.find((r) => r.kind === kind)?.result ?? null;
  return { idPortrait: pick("id_portrait"), livePortrait: pick("live_portrait"), match: pick("face_match") };
}
