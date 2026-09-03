/**
 * Décaissement et remboursements.
 *
 * Le décaissement est bloqué tant que les conditions obligatoires du dossier
 * ne sont pas réunies (contrat signé, garantie réglée, assurance validée,
 * coordonnées bancaires présentes). La bascule « Décaissé » exige une
 * confirmation explicite de l'administrateur.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const INSTALLMENT_STATUSES = [
  "upcoming",
  "paid",
  "partially_paid",
  "late",
  "cancelled",
] as const;
export type InstallmentStatus = (typeof INSTALLMENT_STATUSES)[number];

async function assertStaff(
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }> },
  userId: string,
) {
  const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (data !== true) throw new Error("forbidden");
}

/** Conditions obligatoires avant tout décaissement. */
export const adminGetDisbursement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ application_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: application }, { data: disbursement }, { data: contract }, { data: guarantee }, { data: insurance }, { data: schedule }] =
      await Promise.all([
        supabaseAdmin
          .from("loan_applications")
          .select(
            "id, reference, status, amount, duration_months, monthly_payment, insurance_monthly, first_instalment_on, bank_holder, bank_iban, bank_bic, bank_name",
          )
          .eq("id", data.application_id)
          .maybeSingle(),
        supabaseAdmin
          .from("disbursements")
          .select("*")
          .eq("application_id", data.application_id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabaseAdmin
          .from("application_contracts")
          .select("id, status, signed_at")
          .eq("application_id", data.application_id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabaseAdmin
          .from("application_guarantees")
          .select("id, payment_status, client_choice, fee_amount")
          .eq("application_id", data.application_id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabaseAdmin
          .from("application_insurances")
          .select("id, status, required, payment_status, fee_amount")
          .eq("application_id", data.application_id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabaseAdmin
          .from("repayment_schedule")
          .select("*")
          .eq("application_id", data.application_id)
          .order("installment_no", { ascending: true }),
      ]);

    if (!application) throw new Error("application_not_found");

    const blockers: string[] = [];
    if (!contract?.signed_at) blockers.push("workflow.guard.contractNotSigned");
    if (guarantee && Number(guarantee.fee_amount ?? 0) > 0 && guarantee.payment_status !== "paid") {
      blockers.push("workflow.guard.guaranteeUnpaid");
    }
    if (insurance?.required && insurance.status !== "validated") {
      blockers.push("workflow.guard.insuranceNotValidated");
    }
    if (!application.bank_iban || !application.bank_holder) blockers.push("workflow.guard.missingPayoutDetails");

    return { application, disbursement, schedule: schedule ?? [], blockers };
  });

/** Prépare le décaissement (aucun fonds n'est envoyé à cette étape). */
export const adminPrepareDisbursement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        application_id: z.string().uuid(),
        amount: z.coerce.number().positive().max(10_000_000),
        currency: z.string().length(3).default("EUR"),
        admin_notes: z.string().max(1000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { applyTransition } = await import("@/lib/workflow.server");
    const server = await import("@/lib/applications.server");
    const { buildPaymentReference } = await import("@/lib/payments.server");

    const { data: application } = await supabaseAdmin
      .from("loan_applications")
      .select("bank_holder, bank_iban, bank_bic, bank_name")
      .eq("id", data.application_id)
      .maybeSingle();
    if (!application?.bank_iban || !application.bank_holder) throw new Error("missing_payout_details");

    const reference = buildPaymentReference("DEC");
    const { data: row, error } = await supabaseAdmin
      .from("disbursements")
      .insert({
        application_id: data.application_id,
        amount: data.amount,
        currency: data.currency,
        beneficiary: application.bank_holder,
        iban: application.bank_iban,
        bic: application.bank_bic,
        bank_name: application.bank_name,
        reference,
        status: "preparing",
        admin_notes: data.admin_notes ?? null,
      } as never)
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    await server.logEvent(data.application_id, "disbursement_prepared", {
      actor: "staff",
      actorId: context.userId,
      metadata: { disbursement_id: row.id, reference, amount: data.amount },
    });

    const transition = await applyTransition({
      applicationId: data.application_id,
      to: "disbursement_preparing",
      actorId: context.userId,
      actor: "staff",
      note: data.admin_notes ?? null,
    });

    return { ok: true as const, id: row.id, reference, transition };
  });

/** Confirmation réelle du virement des fonds au client. */
export const adminConfirmDisbursement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        application_id: z.string().uuid(),
        disbursement_id: z.string().uuid(),
        confirmed: z.literal(true),
        admin_notes: z.string().max(1000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { applyTransition, queueEmail } = await import("@/lib/workflow.server");
    const server = await import("@/lib/applications.server");

    const { error } = await supabaseAdmin
      .from("disbursements")
      .update({
        status: "disbursed",
        processed_at: new Date().toISOString(),
        processed_by: context.userId,
        admin_notes: data.admin_notes ?? null,
      } as never)
      .eq("id", data.disbursement_id)
      .eq("application_id", data.application_id);
    if (error) throw new Error(error.message);

    await server.logEvent(data.application_id, "disbursement_confirmed", {
      actor: "staff",
      actorId: context.userId,
      metadata: { disbursement_id: data.disbursement_id },
    });

    const transition = await applyTransition({
      applicationId: data.application_id,
      to: "disbursed",
      actorId: context.userId,
      actor: "staff",
      note: data.admin_notes ?? null,
    });

    const { data: app } = await supabaseAdmin
      .from("loan_applications")
      .select("reference, email, language, first_name")
      .eq("id", data.application_id)
      .maybeSingle();
    if (app?.email) {
      await queueEmail({
        applicationId: data.application_id,
        to: app.email,
        locale: app.language,
        template: "disbursed",
        vars: { reference: app.reference, firstName: app.first_name ?? "", reason: "" },
      });
    }

    return { ok: true as const, transition };
  });

/** Génère l'échéancier définitif à partir de l'offre validée. */
export const adminGenerateSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        application_id: z.string().uuid(),
        first_due_date: z.string().date(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const server = await import("@/lib/applications.server");

    const { data: application } = await supabaseAdmin
      .from("loan_applications")
      .select("amount, duration_months, monthly_payment, insurance_monthly, product_id")
      .eq("id", data.application_id)
      .maybeSingle();
    if (!application?.amount || !application.duration_months || !application.monthly_payment) {
      throw new Error("incomplete_pricing");
    }

    const { data: product } = application.product_id
      ? await supabaseAdmin
          .from("loan_products")
          .select("annual_rate")
          .eq("id", application.product_id)
          .maybeSingle()
      : { data: null };

    const monthlyRate = Number(product?.annual_rate ?? 0) / 100 / 12;
    const insurance = Number(application.insurance_monthly ?? 0);
    const payment = Number(application.monthly_payment) - insurance;
    let balance = Number(application.amount);
    const start = new Date(`${data.first_due_date}T00:00:00Z`);

    const rows = Array.from({ length: Number(application.duration_months) }, (_, index) => {
      const interest = Math.round(balance * monthlyRate * 100) / 100;
      const principal = Math.round((payment - interest) * 100) / 100;
      balance = Math.max(0, Math.round((balance - principal) * 100) / 100);
      const due = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, start.getUTCDate()));
      return {
        application_id: data.application_id,
        installment_no: index + 1,
        due_date: due.toISOString().slice(0, 10),
        amount: Math.round((principal + interest + insurance) * 100) / 100,
        principal,
        interest,
        insurance,
        remaining_balance: balance,
        paid: false,
        paid_amount: 0,
        status: "upcoming",
      };
    });

    await supabaseAdmin.from("repayment_schedule").delete().eq("application_id", data.application_id);
    const { error } = await supabaseAdmin.from("repayment_schedule").insert(rows as never);
    if (error) throw new Error(error.message);

    await server.logEvent(data.application_id, "schedule_generated", {
      actor: "staff",
      actorId: context.userId,
      metadata: { installments: rows.length, first_due_date: data.first_due_date },
    });

    return { ok: true as const, installments: rows.length };
  });

/** Enregistre un paiement reçu sur une échéance (total ou partiel). */
export const adminRecordRepayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        application_id: z.string().uuid(),
        installment_id: z.string().uuid(),
        amount: z.coerce.number().positive().max(1_000_000),
        notes: z.string().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const server = await import("@/lib/applications.server");
    const { buildPaymentReference } = await import("@/lib/payments.server");

    const { data: installment } = await supabaseAdmin
      .from("repayment_schedule")
      .select("id, amount, paid_amount, installment_no")
      .eq("id", data.installment_id)
      .eq("application_id", data.application_id)
      .maybeSingle();
    if (!installment) throw new Error("installment_not_found");

    const paidAmount = Number(installment.paid_amount ?? 0) + data.amount;
    const complete = paidAmount + 0.01 >= Number(installment.amount);

    const { error } = await supabaseAdmin
      .from("repayment_schedule")
      .update({
        paid_amount: paidAmount,
        paid: complete,
        paid_at: complete ? new Date().toISOString() : null,
        status: complete ? "paid" : "partially_paid",
        notes: data.notes ?? null,
      } as never)
      .eq("id", data.installment_id);
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("application_payments").insert({
      application_id: data.application_id,
      purpose: "installment",
      installment_id: data.installment_id,
      provider: "bank_transfer",
      reference: buildPaymentReference("REM"),
      amount: data.amount,
      status: "received",
      received_at: new Date().toISOString(),
      validated_by: context.userId,
      admin_notes: data.notes ?? null,
    } as never);

    await server.logEvent(data.application_id, "repayment_recorded", {
      actor: "staff",
      actorId: context.userId,
      metadata: { installment_no: installment.installment_no, amount: data.amount },
    });

    return { ok: true as const, complete };
  });

/** Force le statut d'une échéance (retard, annulation…). */
export const adminSetInstallmentStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        application_id: z.string().uuid(),
        installment_id: z.string().uuid(),
        status: z.enum(INSTALLMENT_STATUSES),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("repayment_schedule")
      .update({ status: data.status, paid: data.status === "paid" } as never)
      .eq("id", data.installment_id)
      .eq("application_id", data.application_id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
