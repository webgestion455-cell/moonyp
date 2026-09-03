/**
 * Paiements — configuration admin, options client et encaissements.
 *
 * Aucun clic client ne vaut paiement : seul un administrateur (virement)
 * ou une confirmation du PSP fait passer un paiement à « received ».
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PAYMENT_PURPOSES, PAYMENT_PROVIDERS } from "@/lib/payments.server";

const PROVIDER_ENUM = z.enum(["bank_transfer", "stripe", "paypal"]);
const KIND_ENUM = z.enum(["bank_transfer", "card", "qr", "crypto", "other"]);

async function assertStaff(
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }> },
  userId: string,
) {
  const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (data !== true) throw new Error("forbidden");
}

const methodSchema = z.object({
  id: z.string().uuid().optional(),
  provider: PROVIDER_ENUM.default("bank_transfer"),
  kind: KIND_ENUM.default("bank_transfer"),
  label: z.string().min(2).max(120),
  holder: z.string().max(160).nullish(),
  iban: z.string().max(48).nullish(),
  bic: z.string().max(16).nullish(),
  bank_name: z.string().max(120).nullish(),
  card_brand: z.string().max(40).nullish(),
  card_last4: z.string().max(4).nullish(),
  address: z.string().max(200).nullish(),
  network: z.string().max(60).nullish(),
  qr_url: z.string().url().max(500).nullish().or(z.literal("")),
  instructions: z.string().max(2000).nullish(),
  currency: z.string().length(3).default("EUR"),
  min_amount: z.coerce.number().min(0).nullish(),
  max_amount: z.coerce.number().min(0).nullish(),
  active: z.boolean().default(true),
  sort_order: z.coerce.number().int().min(0).max(999).default(0),
});

/* ---------------------------------------------------------------- ADMIN */

export const adminPaymentSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertStaff(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { providerStatuses } = await import("@/lib/payments.server");
    const { data, error } = await supabaseAdmin
      .from("payment_methods")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return { methods: data ?? [], providers: providerStatuses() };
  });

export const adminSavePaymentMethod = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => methodSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { id, ...payload } = data;
    const row = {
      ...payload,
      qr_url: payload.qr_url ? payload.qr_url : null,
      max_amount: payload.max_amount ?? null,
      min_amount: payload.min_amount ?? null,
    };
    const query = id
      ? supabaseAdmin.from("payment_methods").update(row as never).eq("id", id)
      : supabaseAdmin.from("payment_methods").insert(row as never);
    const { error } = await query;
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const adminSetPaymentMethodActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid(), active: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("payment_methods")
      .update({ active: data.active } as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const adminDeletePaymentMethod = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("payment_methods").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const adminListPayments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ application_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("application_payments")
      .select("*")
      .eq("application_id", data.application_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/** Confirmation réelle d'un encaissement (jamais automatique). */
export const adminUpdatePaymentStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["pending", "processing", "received", "failed", "cancelled"]),
        admin_notes: z.string().max(1000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const server = await import("@/lib/applications.server");

    const { data: payment } = await supabaseAdmin
      .from("application_payments")
      .select("id, application_id, purpose, amount, currency, reference, installment_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!payment) throw new Error("payment_not_found");

    const received = data.status === "received";
    const { error } = await supabaseAdmin
      .from("application_payments")
      .update({
        status: data.status,
        admin_notes: data.admin_notes ?? null,
        received_at: received ? new Date().toISOString() : null,
        validated_by: received ? context.userId : null,
      } as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    if (received && payment.installment_id) {
      const { data: inst } = await supabaseAdmin
        .from("repayment_schedule")
        .select("amount, paid_amount")
        .eq("id", payment.installment_id)
        .maybeSingle();
      if (inst) {
        const paidAmount = Number(inst.paid_amount ?? 0) + Number(payment.amount);
        const complete = paidAmount + 0.01 >= Number(inst.amount);
        await supabaseAdmin
          .from("repayment_schedule")
          .update({
            paid_amount: paidAmount,
            paid: complete,
            paid_at: complete ? new Date().toISOString() : null,
            status: complete ? "paid" : "partially_paid",
          } as never)
          .eq("id", payment.installment_id);
      }
    }

    await server.logEvent(payment.application_id, "payment_status_changed", {
      actor: "staff",
      actorId: context.userId,
      description: data.admin_notes ?? undefined,
      metadata: { payment_id: payment.id, reference: payment.reference, status: data.status },
    });

    return { ok: true as const };
  });

/* --------------------------------------------------------------- CLIENT */

/** Moyens réellement disponibles + montants dus, pour le lien sécurisé. */
export const getPaymentOptions = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ token: z.string().min(20).max(200) }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const server = await import("@/lib/applications.server");
    const { providerStatuses } = await import("@/lib/payments.server");

    const applicationId = await server.resolveToken(data.token);
    if (!applicationId) throw new Error("invalid_token");

    const [{ data: application }, { data: methods }, { data: payments }, { data: guarantee }, { data: insurance }] =
      await Promise.all([
        supabaseAdmin
          .from("loan_applications")
          .select("id, reference, email, first_name, last_name")
          .eq("id", applicationId)
          .maybeSingle(),
        supabaseAdmin
          .from("payment_methods")
          .select(
            "id, provider, kind, label, holder, iban, bic, bank_name, card_brand, card_last4, address, network, qr_url, instructions, currency, min_amount, max_amount, sort_order",
          )
          .eq("active", true)
          .order("sort_order", { ascending: true }),
        supabaseAdmin
          .from("application_payments")
          .select("id, purpose, amount, currency, reference, status, instructions, provider, created_at, received_at")
          .eq("application_id", applicationId)
          .order("created_at", { ascending: false }),
        supabaseAdmin
          .from("application_guarantees")
          .select("id, fee_amount, currency, payment_status, payment_reference")
          .eq("application_id", applicationId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabaseAdmin
          .from("application_insurances")
          .select("id, fee_amount, monthly_premium, currency, payment_status, payment_reference")
          .eq("application_id", applicationId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

    if (!application) throw new Error("invalid_token");

    const available = (methods ?? []).filter((m) => {
      const status = providerStatuses().find((p) => p.id === m.provider);
      return status ? status.configured : false;
    });

    const dues: Array<{ purpose: string; amount: number; currency: string; status: string }> = [];
    if (guarantee && Number(guarantee.fee_amount ?? 0) > 0) {
      dues.push({
        purpose: "guarantee_fee",
        amount: Number(guarantee.fee_amount),
        currency: guarantee.currency ?? "EUR",
        status: guarantee.payment_status ?? "unpaid",
      });
    }
    if (insurance && Number(insurance.fee_amount ?? 0) > 0) {
      dues.push({
        purpose: "insurance_fee",
        amount: Number(insurance.fee_amount),
        currency: insurance.currency ?? "EUR",
        status: (insurance as { payment_status?: string }).payment_status ?? "unpaid",
      });
    }

    return {
      reference: application.reference,
      methods: available,
      providers: providerStatuses().map((p) => ({ id: p.id, configured: p.configured })),
      payments: payments ?? [],
      dues,
    };
  });

/** Crée une intention de paiement : instructions de virement ou redirection PSP. */
export const createPaymentIntent = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        token: z.string().min(20).max(200),
        method_id: z.string().uuid(),
        purpose: z.enum(PAYMENT_PURPOSES),
        amount: z.coerce.number().positive().max(1_000_000),
        return_url: z.string().url().max(500),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const server = await import("@/lib/applications.server");
    const { getProvider, buildPaymentReference } = await import("@/lib/payments.server");

    const applicationId = await server.resolveToken(data.token);
    if (!applicationId) throw new Error("invalid_token");
    if (!server.rateLimit(`pay:${applicationId}`, 10, 60_000)) throw new Error("rate_limited");

    const { data: method } = await supabaseAdmin
      .from("payment_methods")
      .select("*")
      .eq("id", data.method_id)
      .eq("active", true)
      .maybeSingle();
    if (!method) throw new Error("method_unavailable");

    const provider = getProvider(method.provider);
    if (!provider.status().configured) throw new Error("provider_not_configured");

    const { data: application } = await supabaseAdmin
      .from("loan_applications")
      .select("reference, email")
      .eq("id", applicationId)
      .maybeSingle();

    const reference = buildPaymentReference();
    const result = await provider.createPayment({
      amount: data.amount,
      currency: method.currency ?? "EUR",
      reference,
      description: `${application?.reference ?? "Moonyp"} — ${data.purpose}`,
      returnUrl: data.return_url,
      cancelUrl: data.return_url,
      customerEmail: application?.email ?? null,
    });

    const { error } = await supabaseAdmin.from("application_payments").insert({
      application_id: applicationId,
      purpose: data.purpose,
      method_id: method.id,
      provider: method.provider,
      provider_reference: result.providerReference,
      reference,
      amount: data.amount,
      currency: method.currency ?? "EUR",
      status: result.status,
      instructions: method.instructions ?? null,
    } as never);
    if (error) throw new Error(error.message);

    await server.logEvent(applicationId, "payment_initiated", {
      description: `${data.purpose} · ${data.amount} ${method.currency ?? "EUR"}`,
      metadata: { reference, provider: method.provider },
    });

    // Le paiement reste « en attente » tant qu'il n'est pas confirmé.
    return {
      reference,
      provider: method.provider as (typeof PAYMENT_PROVIDERS)[number],
      redirectUrl: result.mode === "redirect" ? result.url : null,
      method: {
        label: method.label,
        holder: method.holder,
        iban: method.iban,
        bic: method.bic,
        bank_name: method.bank_name,
        address: method.address,
        network: method.network,
        qr_url: method.qr_url,
        instructions: method.instructions,
        currency: method.currency,
        kind: method.kind,
      },
    };
  });
