import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { quote } from "@/lib/loan-math";
import type { LoanProduct, Quotation } from "@/lib/loan-math";
import { submitPayloadSchema } from "@/lib/application-schema";

export const listProducts = createServerFn({ method: "GET" }).handler(async (): Promise<LoanProduct[]> => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("loan_products")
    .select("*")
    .eq("active", true)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((p) => ({
    ...p,
    min_amount: Number(p.min_amount),
    max_amount: Number(p.max_amount),
    amount_step: Number(p.amount_step),
    annual_rate: Number(p.annual_rate),
    insurance_monthly_rate: Number(p.insurance_monthly_rate),
    fee_fixed: Number(p.fee_fixed),
    fee_percent: Number(p.fee_percent),
  })) as LoanProduct[];
});

export const listDocumentTypes = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("document_types")
    .select("slug, i18n_key, label, required, accepts_multiple, max_size_mb, allowed_mime, sort_order")
    .eq("active", true)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
});

/** Authoritative quotation: pricing always comes from the stored product. */
export const simulate = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        product_id: z.string().uuid(),
        amount: z.coerce.number().positive(),
        months: z.coerce.number().int().positive(),
        insurance: z.boolean().optional().default(false),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<Quotation & { productSlug: string }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: product, error } = await supabaseAdmin
      .from("loan_products")
      .select("*")
      .eq("id", data.product_id)
      .eq("active", true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!product) throw new Error("product_not_found");

    const amount = Math.min(Math.max(data.amount, Number(product.min_amount)), Number(product.max_amount));
    const months = Math.min(Math.max(data.months, product.min_months), product.max_months);

    return {
      ...quote(
        {
          annual_rate: Number(product.annual_rate),
          insurance_monthly_rate: Number(product.insurance_monthly_rate),
          fee_fixed: Number(product.fee_fixed),
          fee_percent: Number(product.fee_percent),
          currency: product.currency,
        },
        amount,
        months,
        data.insurance,
      ),
      productSlug: product.slug,
    };
  });

/** Creates the application, its reference, its audit trail and its secure link. */
export const submitApplication = createServerFn({ method: "POST" })
  .inputValidator((input) => submitPayloadSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const server = await import("@/lib/applications.server");

    const ip =
      getRequestHeader("cf-connecting-ip") ??
      getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim() ??
      null;

    if (!server.rateLimit(`submit:${ip ?? "unknown"}`, 5, 10 * 60 * 1000)) {
      throw new Error("rate_limited");
    }

    const { data: product } = await supabaseAdmin
      .from("loan_products")
      .select("*")
      .eq("id", data.product_id)
      .eq("active", true)
      .maybeSingle();
    if (!product) throw new Error("product_not_found");

    const amount = Math.min(Math.max(data.amount, Number(product.min_amount)), Number(product.max_amount));
    const months = Math.min(Math.max(data.duration_months, product.min_months), product.max_months);

    const applicationPayload = {
        status: "received",
        language: data.language,
        product_id: product.id,
        first_name: data.first_name,
        last_name: data.last_name,
        birth_date: data.birth_date,
        nationality: data.nationality || null,
        address: data.address,
        postal_code: data.postal_code,
        city: data.city,
        country: data.country,
        phone: data.phone,
        email: data.email.toLowerCase(),
        employment_status: data.employment_status,
        profession: data.profession || null,
        employer: data.employer || null,
        seniority_months: data.seniority_months,
        monthly_income: data.monthly_income,
        monthly_charges: data.monthly_charges,
        other_income: data.other_income,
        household_size: data.household_size,
        amount,
        duration_months: months,
        purpose: data.purpose || null,
        insurance_opted: data.insurance_opted,
        bank_holder: data.bank_holder,
        bank_name: data.bank_name || null,
        bank_iban: data.bank_iban,
        bank_bic: data.bank_bic || null,
        consent_terms: data.consent_terms,
        consent_privacy: data.consent_privacy,
        consent_marketing: data.consent_marketing ?? false,
        current_step: 6,
        submitted_at: new Date().toISOString(),
      created_ip: ip,
    };

    const { data: inserted, error } = await supabaseAdmin
      .from("loan_applications")
      .insert(applicationPayload as never)
      .select("id, reference, status, created_at")
      .single();

    if (error) throw new Error(error.message);

    const token = await server.issuePortalToken(inserted.id);
    await server.logEvent(inserted.id, "application_submitted", {
      description: "Demande soumise par le demandeur",
      metadata: { amount, months, product: product.slug },
      ip,
    });

    return {
      id: inserted.id,
      reference: inserted.reference,
      status: inserted.status,
      created_at: inserted.created_at,
      token,
    };
  });

/** Attaches documents that were uploaded through a signed URL. */
export const registerDocuments = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        token: z.string().min(20).max(200),
        documents: z
          .array(
            z.object({
              document_type_slug: z.string().min(1).max(60),
              storage_path: z.string().min(1).max(400),
              file_name: z.string().min(1).max(255),
              mime_type: z.string().min(1).max(120),
              file_size: z.coerce.number().int().min(1).max(25 * 1024 * 1024),
            }),
          )
          .min(1)
          .max(12),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const server = await import("@/lib/applications.server");

    const applicationId = await server.resolveToken(data.token);
    if (!applicationId) throw new Error("invalid_token");

    const rows = data.documents
      .filter((d) => d.storage_path.startsWith(`${applicationId}/`))
      .map((d) => ({ ...d, application_id: applicationId }));
    if (rows.length === 0) throw new Error("invalid_path");

    const { error } = await supabaseAdmin.from("application_documents").insert(rows);
    if (error) throw new Error(error.message);

    await server.logEvent(applicationId, "documents_uploaded", {
      description: `${rows.length} document(s) déposé(s)`,
      metadata: { types: rows.map((r) => r.document_type_slug) },
    });
    return { ok: true, count: rows.length };
  });

/** Issues a one-shot signed upload URL into the private KYC bucket. */
export const createUploadUrl = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        token: z.string().min(20).max(200),
        document_type_slug: z.string().min(1).max(60),
        file_name: z.string().min(1).max(255),
        mime_type: z.string().min(1).max(120),
        file_size: z.coerce.number().int().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const server = await import("@/lib/applications.server");

    const applicationId = await server.resolveToken(data.token);
    if (!applicationId) throw new Error("invalid_token");

    const { data: type } = await supabaseAdmin
      .from("document_types")
      .select("allowed_mime, max_size_mb")
      .eq("slug", data.document_type_slug)
      .eq("active", true)
      .maybeSingle();
    if (!type) throw new Error("unknown_document_type");
    if (!type.allowed_mime.includes(data.mime_type)) throw new Error("mime_not_allowed");
    if (data.file_size > type.max_size_mb * 1024 * 1024) throw new Error("file_too_large");

    const safeName = data.file_name.replace(/[^\w.-]+/g, "_").slice(-120);
    const path = `${applicationId}/${data.document_type_slug}/${Date.now()}-${safeName}`;

    const { data: signed, error } = await supabaseAdmin.storage
      .from("kyc-documents")
      .createSignedUploadUrl(path);
    if (error) throw new Error(error.message);

    return { path, token: signed.token, signedUrl: signed.signedUrl };
  });

/** Everything the applicant may see through the secure link. */
export const getApplicationByToken = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ token: z.string().min(20).max(200) }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const server = await import("@/lib/applications.server");

    const applicationId = await server.resolveToken(data.token);
    if (!applicationId) return null;

    const [{ data: application }, { data: history }, { data: documents }] = await Promise.all([
      supabaseAdmin.from("loan_applications").select("*").eq("id", applicationId).maybeSingle(),
      supabaseAdmin
        .from("application_status_history")
        .select("new_status, created_at, note")
        .eq("application_id", applicationId)
        .order("created_at", { ascending: true }),
      supabaseAdmin
        .from("application_documents")
        .select("id, document_type_slug, file_name, status, review_note, created_at")
        .eq("application_id", applicationId)
        .order("created_at", { ascending: true }),
    ]);

    if (!application) return null;

    const { data: product } = application.product_id
      ? await supabaseAdmin
          .from("loan_products")
          .select("slug, name, i18n_key, currency, annual_rate, insurance_monthly_rate, fee_fixed, fee_percent")
          .eq("id", application.product_id)
          .maybeSingle()
      : { data: null };

    return {
      application,
      product,
      history: history ?? [],
      documents: documents ?? [],
    };
  });
