/**
 * Lecture admin de l'état réel des contrôles KYC d'un dossier.
 *
 * Cette fonction ne calcule rien et ne promeut rien : elle expose, contrôle
 * par contrôle, la dernière ligne réellement écrite par le moteur
 * (`application_kyc_controls`), et NOT_STARTED pour les contrôles jamais
 * exécutés. Un contrôle absent n'est jamais présenté comme « vérifié ».
 *
 * Elle indique en plus l'état des dépendances internes (liste de screening
 * active, travaux du moteur facial) afin que l'équipe conformité sache
 * pourquoi un contrôle reste NOT_VERIFIED ou INCONCLUSIVE.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  CONTROL_DEFINITIONS,
  STEP_ORDER,
  type ControlKey,
  type ControlStatus,
  type StepKey,
  type StepStatus,
} from "@/lib/kyc/controls";

async function assertStaff(
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }> },
  userId: string,
) {
  const { data } = await supabase.rpc("is_staff", { _user_id: userId });
  if (data !== true) throw new Error("forbidden");
}

type SerializableDetails =
  | string
  | number
  | boolean
  | null
  | SerializableDetails[]
  | { [key: string]: SerializableDetails };

export interface AdminControlView {
  control: ControlKey;
  step: StepKey;
  required: boolean;
  /** Non vérifiable par construction (aucune bibliothèque locale ne le permet). */
  unverifiable: boolean;
  unverifiable_reason: string | null;
  status: ControlStatus;
  executed: boolean;
  attempt: number | null;
  method: string | null;
  library: string | null;
  library_version: string | null;
  score: number | null;
  threshold: number | null;
  reasons: string[];
  details: { [key: string]: SerializableDetails };
  recorded_at: string | null;
}

export interface AdminKycControlState {
  application_id: string;
  session_id: string | null;
  aggregate: string;
  required_steps: StepKey[];
  steps: { step: StepKey; status: StepStatus; attempt: number; updated_at: string | null }[];
  controls: AdminControlView[];
  engine: {
    /** Liste sanctions/PEP réellement chargée en base, sinon null. */
    screening_list: {
      source: string | null;
      version: string | null;
      entry_count: number;
      imported_at: string | null;
    } | null;
    /** Travaux du moteur facial pour ce dossier, par statut. */
    face_jobs: { pending: number; running: number; done: number; error: number };
  };
}

export const adminKycControlState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ applicationId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<AdminKycControlState> => {
    await assertStaff(context.supabase as never, context.userId);

    const { readSession } = await import("@/lib/kyc/orchestrator.server");
    const { loadScreeningList } = await import("@/lib/kyc/persistence.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const view = await readSession(data.applicationId, null);

    // Dernière ligne écrite par contrôle (les lignes sont append-only).
    const latest = new Map<string, (typeof view.controls)[number]>();
    for (const row of view.controls) latest.set(row.control_key, row);

    const controls: AdminControlView[] = CONTROL_DEFINITIONS.slice()
      .sort((a, b) => STEP_ORDER.indexOf(a.step) - STEP_ORDER.indexOf(b.step))
      .map((def) => {
        const row = latest.get(def.key);
        return {
          control: def.key,
          step: def.step,
          required: def.required,
          unverifiable: Boolean(def.unverifiable),
          unverifiable_reason: def.unverifiableReason ?? null,
          status: (row?.status as ControlStatus) ?? "NOT_STARTED",
          executed: row?.executed ?? false,
          attempt: row?.attempt ?? null,
          method: row?.method ?? null,
          library: row?.library ?? null,
          library_version: row?.library_version ?? null,
          score: row?.score ?? null,
          threshold: row?.threshold ?? null,
          reasons: row?.reasons ?? [],
          details: (row?.details ?? {}) as { [key: string]: SerializableDetails },
          recorded_at: row?.created_at ?? null,
        };
      });

    const screening = await loadScreeningList();

    const jobs = (await (
      supabaseAdmin as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (k: string, v: string) => Promise<{ data: { status: string }[] | null }>;
          };
        };
      }
    )
      .from("application_kyc_face_jobs")
      .select("status")
      .eq("application_id", data.applicationId)) as { data: { status: string }[] | null };

    const counts = { pending: 0, running: 0, done: 0, error: 0 };
    for (const j of jobs.data ?? []) {
      if (j.status in counts) counts[j.status as keyof typeof counts] += 1;
    }

    return {
      application_id: data.applicationId,
      session_id: view.session_id,
      aggregate: view.aggregate,
      required_steps: view.required_steps as StepKey[],
      steps: view.steps,
      controls,
      engine: {
        screening_list: screening.list
          ? {
              source: screening.list.source,
              version: screening.list.version,
              entry_count: screening.list.entry_count,
              imported_at: screening.list.imported_at,
            }
          : null,
        face_jobs: counts,
      },
    };
  });
