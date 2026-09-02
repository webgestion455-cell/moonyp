import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { INFO_REQUEST_KINDS, REASON_REQUIRED } from "@/lib/application-workflow";
import { APPLICATION_STATUS_ORDER } from "@/lib/application-status";

const STATUSES = APPLICATION_STATUS_ORDER as unknown as [
  (typeof APPLICATION_STATUS_ORDER)[number],
  ...(typeof APPLICATION_STATUS_ORDER)[number][],
];


async function assertStaff(supabase: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }> }, userId: string) {
  const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (data !== true) throw new Error("forbidden");
}

/** Paginated application list for the back-office. */
export const adminListApplications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        search: z.string().max(120).optional(),
        status: z.enum(STATUSES).optional(),
        limit: z.coerce.number().int().min(1).max(200).optional().default(50),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let query = supabaseAdmin
      .from("loan_applications")
      .select(
        "id, reference, status, first_name, last_name, email, phone, city, country, amount, duration_months, monthly_income, product_id, submitted_at, created_at, updated_at",
      )
      .order("created_at", { ascending: false })
      .limit(data.limit);

    if (data.status) query = query.eq("status", data.status);
    if (data.search) {
      const s = data.search.replace(/[%,()]/g, "").trim();
      if (s) {
        query = query.or(
          `reference.ilike.%${s}%,email.ilike.%${s}%,last_name.ilike.%${s}%,first_name.ilike.%${s}%`,
        );
      }
    }

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/** Aggregated KPIs powering the admin overview. */
export const adminApplicationStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertStaff(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data, error } = await supabaseAdmin
      .from("loan_applications")
      .select("status, amount, created_at")
      .order("created_at", { ascending: true })
      .limit(5000);
    if (error) throw new Error(error.message);

    const rows = data ?? [];
    const byStatus: Record<string, number> = {};
    for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;

    // 12-month volume series
    const months: { key: string; label: string; count: number; volume: number }[] = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      months.push({
        key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
        label: d.toLocaleDateString("fr-FR", { month: "short" }),
        count: 0,
        volume: 0,
      });
    }
    for (const r of rows) {
      const k = String(r.created_at).slice(0, 7);
      const bucket = months.find((m) => m.key === k);
      if (bucket) {
        bucket.count += 1;
        bucket.volume += Number(r.amount ?? 0);
      }
    }

    const disbursedStatuses = new Set(["disbursed", "repaying", "late", "repaid"]);
    return {
      total: rows.length,
      byStatus,
      months,
      pending: rows.filter((r) => ["received", "verification", "analysis", "documents_missing", "info_requested"].includes(r.status)).length,
      approved: rows.filter((r) => ["approved", "offer_available", "contract_sent", "signature_pending", "contract_signed"].includes(r.status)).length,
      rejected: rows.filter((r) => r.status === "rejected").length,
      disbursedCount: rows.filter((r) => disbursedStatuses.has(r.status)).length,
      disbursedVolume: rows
        .filter((r) => disbursedStatuses.has(r.status))
        .reduce((s, r) => s + Number(r.amount ?? 0), 0),
      totalVolume: rows.reduce((s, r) => s + Number(r.amount ?? 0), 0),
    };
  });

/** Full application file with history and signed document links. */
export const adminGetApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [
      { data: application },
      { data: history },
      { data: documents },
      { data: events },
      { data: kyc },
      { data: infoRequests },
    ] = await Promise.all([
        supabaseAdmin.from("loan_applications").select("*").eq("id", data.id).maybeSingle(),
        supabaseAdmin
          .from("application_status_history")
          .select("id, old_status, new_status, actor, note, reason, created_at")
          .eq("application_id", data.id)
          .order("created_at", { ascending: true }),
        supabaseAdmin
          .from("application_documents")
          .select("id, document_type_slug, file_name, storage_path, mime_type, file_size, status, review_note, created_at")
          .eq("application_id", data.id)
          .order("created_at", { ascending: true }),
        supabaseAdmin
          .from("application_events")
          .select("id, event_type, actor, description, created_at")
          .eq("application_id", data.id)
          .order("created_at", { ascending: false })
          .limit(50),
        supabaseAdmin
          .from("application_kyc_checks")
          .select("id, step_key, category, document_type_slug, document_id, status, attempts, review_note, reviewed_at, created_at")
          .eq("application_id", data.id)
          .order("created_at", { ascending: true }),
        supabaseAdmin
          .from("application_info_requests")
          .select("id, kind, message, status, document_type_slug, response_text, responded_at, created_at")
          .eq("application_id", data.id)
          .order("created_at", { ascending: false }),
      ]);


    if (!application) return null;

    const withLinks = await Promise.all(
      (documents ?? []).map(async (d) => {
        const { data: signed } = await supabaseAdmin.storage
          .from("kyc-documents")
          .createSignedUrl(d.storage_path, 300);
        return { ...d, url: signed?.signedUrl ?? null };
      }),
    );

    const { data: product } = application.product_id
      ? await supabaseAdmin.from("loan_products").select("*").eq("id", application.product_id).maybeSingle()
      : { data: null };

    const { loadWorkflowContext } = await import("@/lib/workflow.server");
    const workflow = await loadWorkflowContext(data.id);

    return {
      application,
      product,
      history: history ?? [],
      documents: withLinks,
      events: events ?? [],
      kycChecks: kyc ?? [],
      infoRequests: infoRequests ?? [],
      workflowContext: workflow?.context ?? {},
    };


  });

/** Moves an application through the workflow (règles centralisées). */
export const adminUpdateApplicationStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(STATUSES),
        note: z.string().max(1000).optional(),
        reason: z.string().max(1000).optional(),
        rejection_reason: z.string().max(1000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase as never, context.userId);
    const { applyTransition } = await import("@/lib/workflow.server");

    const reason = data.reason ?? data.rejection_reason ?? null;
    if (REASON_REQUIRED.includes(data.status) && !reason?.trim()) {
      return { ok: false as const, reason: "workflow.error.reasonRequired" };
    }

    const result = await applyTransition({
      applicationId: data.id,
      to: data.status,
      actorId: context.userId,
      actor: "staff",
      reason,
      note: data.note ?? null,
    });
    return result;
  });

/** Ouvre une demande d'information / de document auprès du client. */
export const adminCreateInfoRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        application_id: z.string().uuid(),
        kind: z.enum(INFO_REQUEST_KINDS),
        message: z.string().min(3).max(1000),
        document_type_slug: z.string().max(60).optional(),
        move_status: z.boolean().optional().default(true),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { applyTransition, queueEmail } = await import("@/lib/workflow.server");
    const server = await import("@/lib/applications.server");

    const { error } = await supabaseAdmin.from("application_info_requests").insert({
      application_id: data.application_id,
      kind: data.kind,
      message: data.message,
      document_type_slug: data.document_type_slug ?? null,
      requested_by: context.userId,
    } as never);
    if (error) throw new Error(error.message);

    await server.logEvent(data.application_id, "info_requested", {
      actor: "staff",
      actorId: context.userId,
      description: data.message,
      metadata: { kind: data.kind, document_type_slug: data.document_type_slug ?? null },
    });

    if (data.move_status) {
      const target = data.kind === "missing_document" ? "documents_missing" : "info_requested";
      const moved = await applyTransition({
        applicationId: data.application_id,
        to: target,
        actorId: context.userId,
        actor: "staff",
        reason: data.message,
      });
      if (moved.ok) return { ok: true as const };
    }

    // Statut inchangé : on informe tout de même le client.
    const { data: app } = await supabaseAdmin
      .from("loan_applications")
      .select("email, language, reference, first_name")
      .eq("id", data.application_id)
      .maybeSingle();
    if (app?.email) {
      await queueEmail({
        applicationId: data.application_id,
        to: app.email,
        locale: app.language,
        template: "infoRequested",
        vars: { reference: app.reference, firstName: app.first_name ?? "", reason: data.message },
      });
    }
    return { ok: true as const };
  });

/** Clôture manuellement une demande d'information. */
export const adminCloseInfoRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("application_info_requests")
      .update({ status: "cancelled" } as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });


/** Approves or rejects a KYC document. */
export const adminReviewDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["pending", "approved", "rejected", "replacement_requested"]),
        review_note: z.string().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("application_documents")
      .update({
        status: data.status,
        review_note: data.review_note ?? null,
        reviewed_by: context.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    // Keep the KYC checklist aligned with the document decision.
    const kycStatus =
      data.status === "approved" ? "passed" : data.status === "pending" ? "verifying" : "failed";
    await supabaseAdmin
      .from("application_kyc_checks")
      .update({
        status: kycStatus,
        review_note: data.review_note ?? null,
        reviewed_by: context.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("document_id", data.id);

    const { data: doc } = await supabaseAdmin
      .from("application_documents")
      .select("application_id")
      .eq("id", data.id)
      .maybeSingle();
    if (doc?.application_id) await refreshKycStatus(doc.application_id);

    return { ok: true };
  });

/** Recomputes the aggregate KYC status of an application from its checks. */
async function refreshKycStatus(applicationId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: checks } = await supabaseAdmin
    .from("application_kyc_checks")
    .select("status")
    .eq("application_id", applicationId);

  const rows = checks ?? [];
  const failed = rows.some((c) => c.status === "failed");
  const allPassed = rows.length > 0 && rows.every((c) => c.status === "passed");
  const status = failed ? "failed" : allPassed ? "passed" : rows.length ? "verifying" : "pending";

  await supabaseAdmin
    .from("loan_applications")
    .update({
      kyc_status: status,
      kyc_completed_at: allPassed ? new Date().toISOString() : null,
      review_required: failed,
    })
    .eq("id", applicationId);
}

/** Manual decision on a single KYC checkpoint. */
export const adminReviewKycCheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["todo", "verifying", "passed", "failed"]),
        review_note: z.string().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: row, error } = await supabaseAdmin
      .from("application_kyc_checks")
      .update({
        status: data.status,
        review_note: data.review_note ?? null,
        reviewed_by: context.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .select("application_id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (row?.application_id) await refreshKycStatus(row.application_id);
    return { ok: true };
  });


/** Issues a fresh secure link for the applicant. */
export const adminIssuePortalLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase as never, context.userId);
    const server = await import("@/lib/applications.server");
    const token = await server.issuePortalToken(data.id, "portal");
    return { token };
  });
