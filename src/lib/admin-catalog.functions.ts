import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertStaff(
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }> },
  userId: string,
) {
  const { data } = await supabase.rpc("is_staff", { _user_id: userId });
  if (data !== true) throw new Error("forbidden");
}

/* -------------------------------------------------------------------------- */
/*                          Catalogue des produits                             */
/* -------------------------------------------------------------------------- */

export const adminListProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertStaff(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("loan_products")
      .select("*")
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const adminUpdateProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        active: z.boolean().optional(),
        min_amount: z.coerce.number().min(0).optional(),
        max_amount: z.coerce.number().min(0).optional(),
        min_months: z.coerce.number().int().min(1).optional(),
        max_months: z.coerce.number().int().min(1).optional(),
        annual_rate: z.coerce.number().min(0).max(100).optional(),
        insurance_monthly_rate: z.coerce.number().min(0).max(100).optional(),
        fee_fixed: z.coerce.number().min(0).optional(),
        fee_percent: z.coerce.number().min(0).max(100).optional(),
        max_dti_percent: z.coerce.number().min(0).max(100).optional(),
        sort_order: z.coerce.number().int().min(0).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { id, ...patch } = data;
    const { error } = await supabaseAdmin.from("loan_products").update(patch as never).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* -------------------------------------------------------------------------- */
/*                             File d'attente KYC                              */
/* -------------------------------------------------------------------------- */

export const adminKycQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        status: z.enum(["all", "verifying", "todo", "failed", "passed"]).optional().default("verifying"),
        limit: z.coerce.number().int().min(1).max(200).optional().default(100),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let query = supabaseAdmin
      .from("application_kyc_checks")
      .select("id, application_id, step_key, category, document_type_slug, status, review_note, created_at")
      .order("created_at", { ascending: true })
      .limit(data.limit);
    if (data.status !== "all") query = query.eq("status", data.status);

    const { data: checks, error } = await query;
    if (error) throw new Error(error.message);

    const ids = [...new Set((checks ?? []).map((c) => c.application_id))];
    const { data: apps } = ids.length
      ? await supabaseAdmin
          .from("loan_applications")
          .select("id, reference, first_name, last_name, email, amount, status, kyc_status")
          .in("id", ids)
      : { data: [] };

    const byId = new Map((apps ?? []).map((a) => [a.id, a]));
    return (checks ?? []).map((c) => ({ ...c, application: byId.get(c.application_id) ?? null }));
  });

/**
 * Compteurs réels de la file KYC, tous états confondus.
 *
 * La section « Conformité — KYC » ne doit jamais paraître vide : même sans
 * contrôle « à vérifier », l'équipe voit le volume par état et peut basculer
 * sur la file correspondante en un clic.
 */
export const adminKycCounters = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertStaff(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data, error } = await supabaseAdmin
      .from("application_kyc_checks")
      .select("status")
      .limit(20000);
    if (error) throw new Error(error.message);

    const counters = { all: 0, todo: 0, verifying: 0, passed: 0, failed: 0 } as Record<string, number>;
    for (const row of data ?? []) {
      const status = String((row as { status: string | null }).status ?? "todo");
      counters.all += 1;
      counters[status] = (counters[status] ?? 0) + 1;
    }
    return counters as { all: number; todo: number; verifying: number; passed: number; failed: number };
  });
