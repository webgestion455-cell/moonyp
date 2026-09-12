/**
 * Étapes Garantie puis Assurance.
 *
 * Règle de sécurité fondamentale : un clic client ne vaut JAMAIS paiement.
 * Le client exprime un choix ; seul un administrateur (ou, plus tard, un
 * évènement de paiement signé par un PSP) fait basculer `payment_status`
 * à « paid » et le dossier vers « guarantee_signed ».
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const GUARANTEE_CHOICES = ["pay_now", "decline", "pay_later"] as const;
export type GuaranteeChoice = (typeof GUARANTEE_CHOICES)[number];

function requestIp(): string | null {
  return (
    getRequestHeader("cf-connecting-ip") ??
    getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim() ??
    null
  );
}

async function assertStaff(
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }> },
  userId: string,
) {
  const { data } = await supabase.rpc("is_staff", { _user_id: userId });
  if (data !== true) throw new Error("forbidden");
}

/** Envoi de la garantie avec les frais de couverture du risque de crédit. */
export const adminSendGuarantee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        application_id: z.string().uuid(),
        kind: z.string().min(2).max(40).default("credit_risk_cover"),
        fee_amount: z.coerce.number().min(0).max(1_000_000),
        currency: z.string().length(3).default("EUR"),
        fee_description: z.string().max(500).optional(),
        payment_instructions: z.string().max(2000).optional(),
        guarantor_name: z.string().max(160).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { applyTransition, queueEmail } = await import("@/lib/workflow.server");
    const server = await import("@/lib/applications.server");

    const { data: app } = await supabaseAdmin
      .from("loan_applications")
      .select("reference, email, language, first_name")
      .eq("id", data.application_id)
      .maybeSingle();
    if (!app) throw new Error("application_not_found");

    const { data: row, error } = await supabaseAdmin
      .from("application_guarantees")
      .insert({
        application_id: data.application_id,
        kind: data.kind,
        guarantor_name: data.guarantor_name ?? null,
        amount: data.fee_amount,
        fee_amount: data.fee_amount,
        fee_description: data.fee_description ?? null,
        payment_instructions: data.payment_instructions ?? null,
        currency: data.currency,
        status: "sent",
        payment_status: "unpaid",
        sent_at: new Date().toISOString(),
      } as never)
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const { generateGuaranteeDocument } = await import("@/lib/coverage-documents.server");
    const artifact = await generateGuaranteeDocument(row.id);

    await server.logEvent(data.application_id, "guarantee_sent", {
      actor: "staff",
      actorId: context.userId,
      description: data.fee_description ?? undefined,
      metadata: { guarantee_id: row.id, fee_amount: data.fee_amount, currency: data.currency },
    });

    const transition = await applyTransition({
      applicationId: data.application_id,
      to: "guarantee_sent",
      // Email dédié `guaranteeSent` envoyé juste après (avec montant et options).
      skipEmail: true,
      actorId: context.userId,
      actor: "staff",
      note: `guarantee fee ${data.fee_amount} ${data.currency}`,
    });

    if (transition.ok && app.email) {
      await queueEmail({
        applicationId: data.application_id,
        to: app.email,
        locale: app.language,
        template: "guaranteeSent",
        vars: {
          reference: app.reference,
          firstName: app.first_name ?? "",
          amount: `${data.fee_amount} ${data.currency}`,
          reason: "",
        },
      });
    }

    return { ok: true as const, id: row.id, transition, artifact };
  });

/** Choix exclusif du client sur les frais de garantie (aucun paiement ici). */
export const chooseGuaranteeOption = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        token: z.string().min(20).max(200),
        guarantee_id: z.string().uuid(),
        choice: z.enum(GUARANTEE_CHOICES),
        scheduled_payment_date: z.string().date().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const server = await import("@/lib/applications.server");
    const { queueEmail, notifyAdmins, applyTransition } = await import("@/lib/workflow.server");

    const applicationId = await server.resolveToken(data.token);
    if (!applicationId) throw new Error("invalid_token");
    if (data.choice === "pay_later" && !data.scheduled_payment_date) {
      return { ok: false as const, reason: "finance.guarantee.error.dateRequired" };
    }
    if (data.scheduled_payment_date && new Date(data.scheduled_payment_date).getTime() < Date.now() - 86_400_000) {
      return { ok: false as const, reason: "finance.guarantee.error.datePast" };
    }

    const { data: guarantee } = await supabaseAdmin
      .from("application_guarantees")
      .select("id, payment_status, currency, fee_amount")
      .eq("id", data.guarantee_id)
      .eq("application_id", applicationId)
      .maybeSingle();
    if (!guarantee) throw new Error("guarantee_not_found");
    if (guarantee.payment_status === "paid") return { ok: true as const, alreadyPaid: true as const };

    const now = new Date().toISOString();
    await supabaseAdmin
      .from("application_guarantees")
      .update({
        client_choice: data.choice,
        choice_at: now,
        scheduled_payment_date: data.choice === "pay_later" ? data.scheduled_payment_date : null,
        payment_status: data.choice === "decline" ? "waived" : "awaiting_payment",
        status: data.choice === "decline" ? "declined" : "accepted",
      } as never)
      .eq("id", guarantee.id);

    await server.logEvent(applicationId, `guarantee_choice_${data.choice}`, {
      actor: "applicant",
      description: data.choice,
      metadata: { guarantee_id: guarantee.id, scheduled_payment_date: data.scheduled_payment_date ?? null },
      ip: requestIp(),
    });

    const { data: app } = await supabaseAdmin
      .from("loan_applications")
      .select("reference, email, language, first_name")
      .eq("id", applicationId)
      .maybeSingle();

    await notifyAdmins({
      title: app?.reference ?? "Dossier",
      message: `Garantie · choix du client : ${data.choice}`,
      link: `/admin/applications/${applicationId}`,
      category: "guarantee",
    });

    const template =
      data.choice === "pay_now"
        ? "guaranteePayNow"
        : data.choice === "decline"
          ? "guaranteeDeclined"
          : "guaranteePayLater";

    if (app?.email) {
      await queueEmail({
        applicationId,
        to: app.email,
        locale: app.language,
        template,
        vars: {
          reference: app.reference,
          firstName: app.first_name ?? "",
          amount: `${Number(guarantee.fee_amount ?? 0)} ${guarantee.currency ?? "EUR"}`,
          date: data.scheduled_payment_date ?? "",
          reason: "",
        },
      });
    }

    // Renoncement : le dossier reste ouvert jusqu'à la clôture explicite d'un
    // administrateur — jamais annulé automatiquement par un clic.
    if (data.choice === "decline") {
      await applyTransition({
        applicationId,
        to: "cancelled",
        actor: "applicant",
        reason: "finance.guarantee.declineReason",
      }).catch(() => null);
    }

    return { ok: true as const, alreadyPaid: false as const };
  });

/** Validation administrative du paiement des frais de garantie. */
export const adminValidateGuaranteePayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        guarantee_id: z.string().uuid(),
        application_id: z.string().uuid(),
        payment_reference: z.string().max(120).optional(),
        note: z.string().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { applyTransition, queueEmail } = await import("@/lib/workflow.server");
    const server = await import("@/lib/applications.server");

    const now = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from("application_guarantees")
      .update({
        payment_status: "paid",
        payment_reference: data.payment_reference ?? null,
        payment_validated_at: now,
        payment_validated_by: context.userId,
        status: "signed",
        signed_at: now,
      } as never)
      .eq("id", data.guarantee_id)
      .eq("application_id", data.application_id);
    if (error) throw new Error(error.message);

    const { generateGuaranteeDocument } = await import("@/lib/coverage-documents.server");
    const artifact = await generateGuaranteeDocument(data.guarantee_id, true);

    await server.logEvent(data.application_id, "guarantee_payment_validated", {
      actor: "staff",
      actorId: context.userId,
      description: data.note ?? undefined,
      metadata: { guarantee_id: data.guarantee_id, payment_reference: data.payment_reference ?? null },
    });

    const transition = await applyTransition({
      applicationId: data.application_id,
      to: "guarantee_signed",
      // Email dédié `guaranteePaymentValidated` envoyé juste après.
      skipEmail: true,
      actorId: context.userId,
      actor: "staff",
      note: data.note ?? null,
    });

    const { data: app } = await supabaseAdmin
      .from("loan_applications")
      .select("reference, email, language, first_name")
      .eq("id", data.application_id)
      .maybeSingle();
    if (transition.ok && app?.email) {
      await queueEmail({
        applicationId: data.application_id,
        to: app.email,
        locale: app.language,
        template: "guaranteePaymentValidated",
        vars: { reference: app.reference, firstName: app.first_name ?? "", reason: "" },
      });
    }

    return { ok: true as const, transition, artifact };
  });

/** Détail garantie + assurance pour le back-office. */
export const adminGetCoverage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ application_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: guarantees }, { data: insurances }] = await Promise.all([
      supabaseAdmin
        .from("application_guarantees")
        .select("*")
        .eq("application_id", data.application_id)
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("application_insurances")
        .select("*")
        .eq("application_id", data.application_id)
        .order("created_at", { ascending: false }),
    ]);
    const { signedCoverageUrl } = await import("@/lib/coverage-documents.server");
    const guaranteeRows = await Promise.all((guarantees ?? []).map(async (row) => ({
      ...row,
      document_url: await signedCoverageUrl("guarantee", row.storage_path),
      signed_document_url: await signedCoverageUrl("guarantee", row.signed_storage_path),
    })));
    const insuranceRows = await Promise.all((insurances ?? []).map(async (row) => ({
      ...row,
      document_url: await signedCoverageUrl("insurance", row.storage_path),
      signed_document_url: await signedCoverageUrl("insurance", (row as typeof row & { signed_storage_path?: string | null }).signed_storage_path ?? null),
    })));
    return { guarantees: guaranteeRows, insurances: insuranceRows };
  });

/** Ouvre l'étape Assurance (distincte de la garantie). */
export const adminSendInsurance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        application_id: z.string().uuid(),
        provider: z.string().max(120).optional(),
        coverage: z.string().max(500).optional(),
        monthly_premium: z.coerce.number().min(0).max(100_000),
        fee_amount: z.coerce.number().min(0).max(100_000).default(0),
        fee_description: z.string().max(500).optional(),
        currency: z.string().length(3).default("EUR"),
        due_date: z.string().date().optional(),
        required: z.boolean().default(true),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { applyTransition, queueEmail } = await import("@/lib/workflow.server");
    const server = await import("@/lib/applications.server");

    const { data: row, error } = await supabaseAdmin
      .from("application_insurances")
      .insert({
        application_id: data.application_id,
        provider: data.provider ?? null,
        coverage: data.coverage ?? null,
        monthly_premium: data.monthly_premium,
        fee_amount: data.fee_amount,
        fee_description: data.fee_description ?? null,
        payment_status: data.fee_amount > 0 ? "pending" : "not_required",
        currency: data.currency,
        status: "pending",
        required: data.required,
        due_date: data.due_date ?? null,
        sent_at: new Date().toISOString(),
      } as never)
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const { generateInsuranceDocument } = await import("@/lib/coverage-documents.server");
    const artifact = await generateInsuranceDocument(row.id);

    // Le dossier porte désormais une assurance : le drapeau déclaratif est
    // aligné sur la réalité, sinon la garde « Assurance validée » refusait la
    // transition et le workflow restait bloqué sur « Assurance en attente ».
    await supabaseAdmin
      .from("loan_applications")
      .update({ insurance_opted: true } as never)
      .eq("id", data.application_id);

    await server.logEvent(data.application_id, "insurance_requested", {
      actor: "staff",
      actorId: context.userId,
      metadata: { insurance_id: row.id, monthly_premium: data.monthly_premium },
    });

    const transition = await applyTransition({
      applicationId: data.application_id,
      to: "insurance_pending",
      // Email dédié `insurancePending` envoyé juste après (avec prime mensuelle).
      skipEmail: true,
      actorId: context.userId,
      actor: "staff",
    });

    const { data: app } = await supabaseAdmin
      .from("loan_applications")
      .select("reference, email, language, first_name")
      .eq("id", data.application_id)
      .maybeSingle();
    if (transition.ok && app?.email) {
      await queueEmail({
        applicationId: data.application_id,
        to: app.email,
        locale: app.language,
        template: "insurancePending",
        vars: {
          reference: app.reference,
          firstName: app.first_name ?? "",
          amount: `${data.monthly_premium} ${data.currency}`,
          reason: "",
        },
      });
    }

    return { ok: true as const, id: row.id, transition, artifact };
  });

/** Validation de l'assurance par le back-office. */
export const adminValidateInsurance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        insurance_id: z.string().uuid(),
        application_id: z.string().uuid(),
        policy_number: z.string().max(120).optional(),
        starts_on: z.string().date().optional(),
        admin_notes: z.string().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { applyTransition, queueEmail } = await import("@/lib/workflow.server");
    const server = await import("@/lib/applications.server");

    const { error } = await supabaseAdmin
      .from("application_insurances")
      .update({
        status: "validated",
        policy_number: data.policy_number ?? null,
        starts_on: data.starts_on ?? null,
        admin_notes: data.admin_notes ?? null,
        validated_at: new Date().toISOString(),
      } as never)
      .eq("id", data.insurance_id)
      .eq("application_id", data.application_id);
    if (error) throw new Error(error.message);

    const { generateInsuranceDocument } = await import("@/lib/coverage-documents.server");
    const artifact = await generateInsuranceDocument(data.insurance_id, true);

    await server.logEvent(data.application_id, "insurance_validated", {
      actor: "staff",
      actorId: context.userId,
      metadata: { insurance_id: data.insurance_id },
    });

    const transition = await applyTransition({
      applicationId: data.application_id,
      to: "insurance_validated",
      // Email dédié `insuranceValidated` envoyé juste après.
      skipEmail: true,
      actorId: context.userId,
      actor: "staff",
      note: data.admin_notes ?? null,
    });

    const { data: app } = await supabaseAdmin
      .from("loan_applications")
      .select("reference, email, language, first_name")
      .eq("id", data.application_id)
      .maybeSingle();
    if (transition.ok && app?.email) {
      await queueEmail({
        applicationId: data.application_id,
        to: app.email,
        locale: app.language,
        template: "insuranceValidated",
        vars: { reference: app.reference, firstName: app.first_name ?? "", reason: "" },
      });
    }

    return { ok: true as const, transition, artifact };
  });

/* ---------------------------------------------------------------------------
 * ASSURANCE — étape distincte de la garantie, avec ses propres frais, choix
 * client, validations et rappels. Même règle de sécurité : un clic client
 * n'emporte JAMAIS paiement ; seul un administrateur valide l'encaissement.
 * ------------------------------------------------------------------------- */

export const INSURANCE_CHOICES = ["pay_now", "decline", "pay_later"] as const;
export type InsuranceChoice = (typeof INSURANCE_CHOICES)[number];

/** Choix exclusif du client sur les frais d'assurance (aucun paiement ici). */
export const chooseInsuranceOption = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        token: z.string().min(20).max(200),
        insurance_id: z.string().uuid(),
        choice: z.enum(INSURANCE_CHOICES),
        scheduled_payment_date: z.string().date().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const server = await import("@/lib/applications.server");
    const { queueEmail, notifyAdmins } = await import("@/lib/workflow.server");

    const applicationId = await server.resolveToken(data.token);
    if (!applicationId) throw new Error("invalid_token");
    if (data.choice === "pay_later" && !data.scheduled_payment_date) {
      return { ok: false as const, reason: "finance.insurance.error.dateRequired" };
    }
    if (
      data.scheduled_payment_date &&
      new Date(data.scheduled_payment_date).getTime() < Date.now() - 86_400_000
    ) {
      return { ok: false as const, reason: "finance.insurance.error.datePast" };
    }

    const { data: insurance } = await supabaseAdmin
      .from("application_insurances")
      .select("id, payment_status, currency, fee_amount")
      .eq("id", data.insurance_id)
      .eq("application_id", applicationId)
      .maybeSingle();
    if (!insurance) throw new Error("insurance_not_found");
    if (insurance.payment_status === "paid") return { ok: true as const, alreadyPaid: true as const };

    const now = new Date().toISOString();
    await supabaseAdmin
      .from("application_insurances")
      .update({
        client_choice: data.choice,
        choice_at: now,
        scheduled_payment_date: data.choice === "pay_later" ? data.scheduled_payment_date : null,
        payment_status: data.choice === "decline" ? "waived" : "awaiting_payment",
        status: data.choice === "decline" ? "declined" : "accepted",
      } as never)
      .eq("id", insurance.id);

    await server.logEvent(applicationId, `insurance_choice_${data.choice}`, {
      actor: "applicant",
      description: data.choice,
      metadata: {
        insurance_id: insurance.id,
        scheduled_payment_date: data.scheduled_payment_date ?? null,
      },
      ip: requestIp(),
    });

    const { data: app } = await supabaseAdmin
      .from("loan_applications")
      .select("reference, email, language, first_name")
      .eq("id", applicationId)
      .maybeSingle();

    await notifyAdmins({
      title: app?.reference ?? "Dossier",
      message: `Assurance · choix du client : ${data.choice}`,
      link: `/admin/applications/${applicationId}`,
      category: "insurance",
    });

    const template =
      data.choice === "pay_now"
        ? "insurancePayNow"
        : data.choice === "decline"
          ? "insuranceDeclined"
          : "insurancePayLater";

    if (app?.email) {
      await queueEmail({
        applicationId,
        to: app.email,
        locale: app.language,
        template,
        vars: {
          reference: app.reference,
          firstName: app.first_name ?? "",
          amount: `${Number(insurance.fee_amount ?? 0)} ${insurance.currency ?? "EUR"}`,
          date: data.scheduled_payment_date ?? "",
          reason: "",
        },
      });
    }

    return { ok: true as const, alreadyPaid: false as const };
  });

/** Validation administrative du paiement des frais d'assurance. */
export const adminValidateInsurancePayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        insurance_id: z.string().uuid(),
        application_id: z.string().uuid(),
        payment_reference: z.string().max(120).optional(),
        note: z.string().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { queueEmail } = await import("@/lib/workflow.server");
    const server = await import("@/lib/applications.server");

    const now = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from("application_insurances")
      .update({
        payment_status: "paid",
        payment_reference: data.payment_reference ?? null,
        payment_validated_at: now,
        payment_validated_by: context.userId,
      } as never)
      .eq("id", data.insurance_id)
      .eq("application_id", data.application_id);
    if (error) throw new Error(error.message);

    const { generateInsuranceDocument } = await import("@/lib/coverage-documents.server");
    const artifact = await generateInsuranceDocument(data.insurance_id, true);

    await server.logEvent(data.application_id, "insurance_payment_validated", {
      actor: "staff",
      actorId: context.userId,
      description: data.note ?? undefined,
      metadata: {
        insurance_id: data.insurance_id,
        payment_reference: data.payment_reference ?? null,
      },
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
        template: "insurancePaymentValidated",
        vars: { reference: app.reference, firstName: app.first_name ?? "", reason: "" },
      });
    }

    return { ok: true as const, artifact };
  });
