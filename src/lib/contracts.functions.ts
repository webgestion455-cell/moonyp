/**
 * Workflow contrat & signature électronique.
 *
 * Côté back-office : préparation (versionnée), prévisualisation, envoi.
 * Côté client : consultation, signature via SignatureService, téléchargement.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function requestIp(): string | null {
  return (
    getRequestHeader("cf-connecting-ip") ??
    getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim() ??
    null
  );
}

function siteUrl(): string {
  return process.env["PUBLIC_SITE_URL"] ?? "https://moonyp.com";
}

async function assertStaff(
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }> },
  userId: string,
) {
  const { data } = await supabase.rpc("is_staff", { _user_id: userId });
  if (data !== true) throw new Error("forbidden");
}

/** Prépare (ou régénère) le contrat courant : nouvelle version en brouillon. */
export const adminPrepareContract = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ application_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { buildContractPdf, storeContractPdf } = await import("@/lib/contract-doc.server");
    const server = await import("@/lib/applications.server");

    const { data: app } = await supabaseAdmin
      .from("loan_applications")
      .select("*")
      .eq("id", data.application_id)
      .maybeSingle();
    if (!app) throw new Error("application_not_found");

    const { data: offer } = await supabaseAdmin
      .from("application_offers")
      .select("*")
      .eq("application_id", data.application_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: product } = app.product_id
      ? await supabaseAdmin
          .from("loan_products")
          .select("currency, annual_rate")
          .eq("id", app.product_id)
          .maybeSingle()
      : { data: null };

    const { data: last } = await supabaseAdmin
      .from("application_contracts")
      .select("version")
      .eq("application_id", data.application_id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const version = Number(last?.version ?? 0) + 1;

    const currency = (offer?.currency as string | undefined) ?? product?.currency ?? "EUR";
    const { bytes, hash } = await buildContractPdf({
      reference: app.reference,
      language: app.language ?? "en",
      version,
      borrower: [app.first_name, app.last_name].filter(Boolean).join(" "),
      address: [app.address, app.postal_code, app.city, app.country].filter(Boolean).join(", "),
      email: app.email ?? "",
      amount: Number(offer?.amount ?? app.amount ?? 0),
      months: Number(offer?.duration_months ?? app.duration_months ?? 0),
      rate: Number(offer?.annual_rate ?? product?.annual_rate ?? app.apr ?? 0),
      monthly: Number(offer?.monthly_payment ?? app.monthly_payment ?? 0),
      totalCost: Number(offer?.total_cost ?? app.total_cost ?? 0),
      insuranceMonthly: Number(app.insurance_monthly ?? 0),
      fees: Number(offer?.fees_total ?? app.fees ?? 0),
      currency,
      purpose: app.purpose ?? null,
      // Données nominatives du dossier : sans elles le contrat imprimerait
      // « Non précisé » sur des mentions obligatoires (date de naissance,
      // téléphone, pays de résidence, IBAN de versement, TAEG, validité).
      apr: Number(app.apr ?? offer?.annual_rate ?? 0) || null,
      phone: app.phone ?? null,
      birthDate: app.birth_date ?? null,
      country: app.country ?? null,
      iban: app.bank_iban ?? null,
      offerValidUntil: (offer?.valid_until as string | null | undefined) ?? null,
    });

    const path = await storeContractPdf(data.application_id, `contract-v${version}.pdf`, bytes);

    const { data: inserted, error } = await supabaseAdmin
      .from("application_contracts")
      .insert({
        application_id: data.application_id,
        offer_id: offer?.id ?? null,
        language: app.language ?? "en",
        version,
        status: "draft",
        storage_path: path,
        document_hash: hash,
        created_by: context.userId,
      } as never)
      .select("id, version")
      .single();
    if (error) throw new Error(error.message);

    await server.logEvent(data.application_id, "contract_prepared", {
      actor: "staff",
      actorId: context.userId,
      description: `v${version}`,
      metadata: { version, hash },
    });

    const { data: signed } = await supabaseAdmin.storage
      .from("contracts")
      .createSignedUrl(path, 600);
    return {
      id: inserted.id,
      version: inserted.version,
      hash,
      previewUrl: signed?.signedUrl ?? null,
    };
  });

/** Liste des versions de contrat + preuves de signature (back-office). */
export const adminListContracts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ application_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: contracts }, { data: requests }] = await Promise.all([
      supabaseAdmin
        .from("application_contracts")
        .select(
          "id, version, status, language, storage_path, signed_storage_path, document_hash, signed_document_hash, sent_at, viewed_at, signed_at, signature_name, signature_method, provider, created_at",
        )
        .eq("application_id", data.application_id)
        .order("version", { ascending: false }),
      supabaseAdmin
        .from("contract_signature_requests")
        .select(
          "id, contract_id, provider, provider_reference, qualified, status, signer_name, signer_ip, requested_at, completed_at, evidence",
        )
        .eq("application_id", data.application_id)
        .order("created_at", { ascending: false }),
    ]);

    const withUrls = await Promise.all(
      (contracts ?? []).map(async (c) => {
        const draft = c.storage_path
          ? ((await supabaseAdmin.storage.from("contracts").createSignedUrl(c.storage_path, 600))
              .data?.signedUrl ?? null)
          : null;
        const signedDoc = c.signed_storage_path
          ? ((
              await supabaseAdmin.storage
                .from("contracts")
                .createSignedUrl(c.signed_storage_path, 600)
            ).data?.signedUrl ?? null)
          : null;
        return { ...c, previewUrl: draft, signedUrl: signedDoc };
      }),
    );

    return { contracts: withUrls, signatureRequests: requests ?? [] };
  });

/** Envoie le contrat au client (email dans sa langue + lien sécurisé). */
export const adminSendContract = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ contract_id: z.string().uuid(), application_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { applyTransition, queueEmail } = await import("@/lib/workflow.server");
    const server = await import("@/lib/applications.server");

    const { data: contract } = await supabaseAdmin
      .from("application_contracts")
      .select("id, version, application_id, storage_path")
      .eq("id", data.contract_id)
      .eq("application_id", data.application_id)
      .maybeSingle();
    if (!contract?.storage_path) throw new Error("contract_not_ready");

    const now = new Date().toISOString();
    await supabaseAdmin
      .from("application_contracts")
      .update({ status: "sent", sent_at: now } as never)
      .eq("id", contract.id);

    const { data: app } = await supabaseAdmin
      .from("loan_applications")
      .select("reference, email, language, first_name")
      .eq("id", data.application_id)
      .maybeSingle();

    const token = await server.issuePortalToken(data.application_id, "contract");
    const lang = (app?.language ?? "en").slice(0, 2).toLowerCase();
    const link = `${siteUrl()}/${lang}/secure/application/${token}/contract`;

    const moved = await applyTransition({
      applicationId: data.application_id,
      to: "contract_sent",
      actorId: context.userId,
      actor: "staff",
      note: `contract v${contract.version}`,
    });

    // L'email « contractSent » est déjà émis par applyTransition (source unique) :
    // aucun second envoi ici, sous peine de doublon dans la file transactionnelle.

    await server.logEvent(data.application_id, "contract_sent", {
      actor: "staff",
      actorId: context.userId,
      description: `v${contract.version}`,
      metadata: { contract_id: contract.id },
    });

    return { ok: true, link, transition: moved };
  });

/** Vue contrat du client, accessible uniquement via le lien sécurisé. */
export const getContractByToken = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ token: z.string().min(20).max(200) }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const server = await import("@/lib/applications.server");

    const applicationId = await server.resolveToken(data.token);
    if (!applicationId) return null;

    const { data: app } = await supabaseAdmin
      .from("loan_applications")
      .select(
        "id, reference, status, language, first_name, last_name, email, amount, duration_months, apr, monthly_payment, insurance_monthly, total_cost, fees, purpose",
      )
      .eq("id", applicationId)
      .maybeSingle();
    if (!app) return null;

    const { data: contract } = await supabaseAdmin
      .from("application_contracts")
      .select(
        "id, version, status, language, sent_at, viewed_at, signed_at, signature_name, signature_method, document_hash, signed_document_hash, storage_path, signed_storage_path, provider, created_at",
      )
      .eq("application_id", applicationId)
      .neq("status", "draft")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: offer } = await supabaseAdmin
      .from("application_offers")
      .select(
        "amount, duration_months, annual_rate, monthly_payment, total_cost, insurance_total, fees_total, currency, valid_until",
      )
      .eq("application_id", applicationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let events: Array<{ event_type: string; created_at: string; actor: string }> = [];
    let signature: {
      id: string;
      status: string;
      provider: string;
      qualified: boolean;
      reference: string | null;
    } | null = null;

    if (contract) {
      if (!contract.viewed_at) {
        await supabaseAdmin
          .from("application_contracts")
          .update({
            viewed_at: new Date().toISOString(),
            status: contract.status === "sent" ? "viewed" : contract.status,
          } as never)
          .eq("id", contract.id);
        await server.logEvent(applicationId, "contract_viewed", {
          actor: "applicant",
          description: `v${contract.version}`,
        });
      }
      const { data: req } = await supabaseAdmin
        .from("contract_signature_requests")
        .select("id, status, provider, qualified, provider_reference")
        .eq("contract_id", contract.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (req) {
        signature = {
          id: req.id,
          status: req.status,
          provider: req.provider,
          qualified: req.qualified,
          reference: req.provider_reference,
        };
        const { data: evts } = await supabaseAdmin
          .from("contract_signature_events")
          .select("event_type, created_at, actor")
          .eq("signature_request_id", req.id)
          .order("created_at", { ascending: true });
        events = evts ?? [];
      }
    }

    return {
      application: app,
      offer,
      contract: contract
        ? {
            id: contract.id,
            version: contract.version,
            status: contract.status,
            language: contract.language,
            sent_at: contract.sent_at,
            signed_at: contract.signed_at,
            signature_name: contract.signature_name,
            document_hash: contract.document_hash,
            signed_document_hash: contract.signed_document_hash,
            provider: contract.provider,
            has_document: Boolean(contract.storage_path),
            has_signed_document: Boolean(contract.signed_storage_path),
            created_at: contract.created_at,
          }
        : null,
      signature,
      events,
    };
  });

/** Démarre la signature : le SignatureService envoie le défi au demandeur. */
export const requestContractSignature = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({ token: z.string().min(20).max(200), full_name: z.string().min(3).max(120) })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const server = await import("@/lib/applications.server");
    const { createSignatureRequest } = await import("@/lib/signature.server");
    const { queueEmail, applyTransition } = await import("@/lib/workflow.server");

    const applicationId = await server.resolveToken(data.token);
    if (!applicationId) throw new Error("invalid_token");
    if (!server.rateLimit(`sign:${applicationId}`, 6, 15 * 60 * 1000))
      throw new Error("rate_limited");

    const { data: app } = await supabaseAdmin
      .from("loan_applications")
      .select("reference, email, language, country, first_name")
      .eq("id", applicationId)
      .maybeSingle();
    const { data: contract } = await supabaseAdmin
      .from("application_contracts")
      .select("id, version, signed_at")
      .eq("application_id", applicationId)
      .neq("status", "draft")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!contract) throw new Error("contract_not_available");
    if (contract.signed_at) return { ok: true as const, alreadySigned: true as const };

    const { id, provider, created } = await createSignatureRequest(
      {
        applicationId,
        contractId: contract.id,
        signerName: data.full_name.trim(),
        signerEmail: app?.email ?? null,
        locale: app?.language ?? null,
        ip: requestIp(),
        userAgent: getRequestHeader("user-agent") ?? null,
      },
      app?.country,
    );

    await supabaseAdmin
      .from("application_contracts")
      .update({ status: "signing" } as never)
      .eq("id", contract.id);

    // L'email « signature en attente » est porté par `signatureCode` (il embarque
    // le code à usage unique) : on neutralise l'email générique pour ne pas
    // envoyer deux messages identiques. Sans code hors bande, l'email de statut
    // reprend la main.
    const signatureCodeEmailed = Boolean(app?.email && created.outOfBandCode);
    await applyTransition({
      applicationId,
      to: "signature_pending",
      actor: "applicant",
      note: `signature request ${created.providerReference}`,
      skipEmail: signatureCodeEmailed,
    });

    if (app?.email && created.outOfBandCode) {
      await queueEmail({
        applicationId,
        to: app.email,
        locale: app.language,
        template: "signatureCode",
        vars: {
          reference: app.reference,
          firstName: app.first_name ?? "",
          code: created.outOfBandCode,
          link: `${siteUrl()}/${(app.language ?? "en").slice(0, 2).toLowerCase()}/secure/application/${await server.issuePortalToken(applicationId, "contract")}/contract`,
          reason: "",
        },
      });
    }

    return {
      ok: true as const,
      alreadySigned: false as const,
      request_id: id,
      challenge: created.challenge,
      redirectUrl: created.redirectUrl ?? null,
      provider: provider.id,
      qualified: provider.qualified,
      expiresAt: created.expiresAt,
    };
  });

/** Finalise la signature : scellement, PDF signé, notification, statut. */
export const signContract = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        token: z.string().min(20).max(200),
        request_id: z.string().uuid(),
        code: z.string().min(4).max(12),
        full_name: z.string().min(3).max(120),
        consent: z.literal(true),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const server = await import("@/lib/applications.server");
    const { completeSignatureRequest } = await import("@/lib/signature.server");
    const { buildContractPdf, storeContractPdf } = await import("@/lib/contract-doc.server");
    const { applyTransition, queueEmail, notifyAdmins } = await import("@/lib/workflow.server");

    const applicationId = await server.resolveToken(data.token);
    if (!applicationId) throw new Error("invalid_token");
    if (!server.rateLimit(`signv:${applicationId}`, 10, 15 * 60 * 1000))
      throw new Error("rate_limited");

    const { data: app } = await supabaseAdmin
      .from("loan_applications")
      .select("*")
      .eq("id", applicationId)
      .maybeSingle();
    if (!app) throw new Error("application_not_found");

    const { data: contract } = await supabaseAdmin
      .from("application_contracts")
      .select("id, version, document_hash, offer_id, signed_at")
      .eq("application_id", applicationId)
      .neq("status", "draft")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!contract) throw new Error("contract_not_available");
    if (contract.signed_at) return { ok: true as const };

    const ip = requestIp();
    const result = await completeSignatureRequest({
      requestId: data.request_id,
      ctx: {
        applicationId,
        contractId: contract.id,
        signerName: data.full_name.trim(),
        signerEmail: app.email,
        locale: app.language,
        ip,
        userAgent: getRequestHeader("user-agent") ?? null,
      },
      code: data.code,
      documentHash: contract.document_hash,
    });
    if (!result.ok)
      return { ok: false as const, reason: result.reason ?? "signature.error.invalidCode" };

    const { data: offer } = contract.offer_id
      ? await supabaseAdmin
          .from("application_offers")
          .select("*")
          .eq("id", contract.offer_id)
          .maybeSingle()
      : { data: null };
    const { data: product } = app.product_id
      ? await supabaseAdmin
          .from("loan_products")
          .select("currency, annual_rate")
          .eq("id", app.product_id)
          .maybeSingle()
      : { data: null };

    const signedAt = new Date().toISOString();
    const { data: sigRow } = await supabaseAdmin
      .from("contract_signature_requests")
      .select("provider_reference, provider, qualified")
      .eq("id", data.request_id)
      .maybeSingle();

    const { bytes, hash } = await buildContractPdf({
      reference: app.reference,
      language: app.language ?? "en",
      version: contract.version,
      borrower: [app.first_name, app.last_name].filter(Boolean).join(" "),
      address: [app.address, app.postal_code, app.city, app.country].filter(Boolean).join(", "),
      email: app.email ?? "",
      amount: Number(offer?.amount ?? app.amount ?? 0),
      months: Number(offer?.duration_months ?? app.duration_months ?? 0),
      rate: Number(offer?.annual_rate ?? product?.annual_rate ?? app.apr ?? 0),
      monthly: Number(offer?.monthly_payment ?? app.monthly_payment ?? 0),
      totalCost: Number(offer?.total_cost ?? app.total_cost ?? 0),
      insuranceMonthly: Number(app.insurance_monthly ?? 0),
      fees: Number(offer?.fees_total ?? app.fees ?? 0),
      currency: (offer?.currency as string | undefined) ?? product?.currency ?? "EUR",
      purpose: app.purpose ?? null,
      // Le contrat signé reprend exactement les mentions du contrat émis.
      apr: Number(app.apr ?? offer?.annual_rate ?? 0) || null,
      phone: app.phone ?? null,
      birthDate: app.birth_date ?? null,
      country: app.country ?? null,
      iban: app.bank_iban ?? null,
      offerValidUntil: (offer?.valid_until as string | null | undefined) ?? null,

      signature: {
        name: data.full_name.trim(),
        signedAt,
        reference: sigRow?.provider_reference ?? data.request_id,
        provider: sigRow?.provider ?? "internal_aes",
        qualified: Boolean(sigRow?.qualified),
        documentHash: contract.document_hash ?? "",
      },
    });

    const path = await storeContractPdf(
      applicationId,
      `contract-v${contract.version}-signed.pdf`,
      bytes,
    );

    await supabaseAdmin
      .from("application_contracts")
      .update({
        status: "signed",
        signed_at: signedAt,
        signed_storage_path: path,
        signed_document_hash: hash,
        signature_name: data.full_name.trim(),
        signature_ip: ip,
        signature_method: sigRow?.provider ?? "internal_aes",
        signature_hash: String((result.evidence as { seal?: string }).seal ?? hash),
      } as never)
      .eq("id", contract.id);

    await server.logEvent(applicationId, "contract_signed", {
      actor: "applicant",
      description: `v${contract.version}`,
      metadata: {
        hash,
        provider: sigRow?.provider ?? "internal_aes",
        qualified: Boolean(sigRow?.qualified),
      },
      ip,
    });

    await applyTransition({
      applicationId,
      to: "contract_signed",
      actor: "applicant",
      note: `signed v${contract.version}`,
      // Email dédié `contractSigned` envoyé juste après (avec lien contrat).
      skipEmail: true,
    });

    await notifyAdmins({
      title: app.reference,
      message: "Contrat signé par le demandeur",
      link: `/admin/applications/${applicationId}`,
      category: "contract",
    });

    if (app.email) {
      await queueEmail({
        applicationId,
        to: app.email,
        locale: app.language,
        template: "contractSigned",
        vars: {
          reference: app.reference,
          firstName: app.first_name ?? "",
          link: `${siteUrl()}/${(app.language ?? "en").slice(0, 2).toLowerCase()}/secure/application/${await server.issuePortalToken(applicationId, "contract")}/contract`,
          reason: "",
        },
      });
    }

    return { ok: true as const };
  });
