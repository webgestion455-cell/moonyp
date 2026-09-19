import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { debtRatio, quote } from "@/lib/loan-math";
import { auditPayout, ibanCountry } from "@/lib/iban";
import type { LoanProduct, Quotation } from "@/lib/loan-math";

import { submitPayloadSchema } from "@/lib/application-schema";

export const listProducts = createServerFn({ method: "GET" }).handler(
  async (): Promise<LoanProduct[]> => {
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
  },
);

export const listDocumentTypes = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("document_types")
    .select(
      "slug, i18n_key, label, required, accepts_multiple, max_size_mb, allowed_mime, sort_order, " +
        "category, capture_mode, sides, employment_statuses, countries, product_slugs",
    )
    .eq("active", true)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Array<{
    slug: string;
    i18n_key: string | null;
    label: string;
    required: boolean;
    accepts_multiple: boolean;
    max_size_mb: number;
    allowed_mime: string[];
    sort_order: number;
    category: "identity" | "address" | "income" | "bank" | "selfie" | "other";
    capture_mode: "scan" | "scan_double" | "selfie" | "upload";
    sides: number;
    employment_statuses: string[];
    countries: string[];
    product_slugs: string[];
  }>;
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

    const amount = Math.min(
      Math.max(data.amount, Number(product.min_amount)),
      Number(product.max_amount),
    );
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

    const { data: product, error: productError } = await supabaseAdmin
      .from("loan_products")
      .select("*")
      .eq("id", data.product_id)
      .eq("active", true)
      .maybeSingle();
    if (productError) {
      console.error("[submitApplication] product lookup failed", productError);
      throw new Error(`product_lookup_failed:${productError.message}`);
    }
    if (!product) throw new Error("product_not_found");

    const amount = Math.min(
      Math.max(data.amount, Number(product.min_amount)),
      Number(product.max_amount),
    );
    const months = Math.min(Math.max(data.duration_months, product.min_months), product.max_months);

    // Authoritative pricing — the client quotation is never trusted.
    const pricing = quote(
      {
        annual_rate: Number(product.annual_rate),
        insurance_monthly_rate: Number(product.insurance_monthly_rate),
        fee_fixed: Number(product.fee_fixed),
        fee_percent: Number(product.fee_percent),
        currency: product.currency,
      },
      amount,
      months,
      data.insurance_opted,
    );

    // Banking coherence audit — hard failures block, soft ones flag for review.
    const audit = auditPayout({
      bank_holder: data.bank_holder,
      bank_iban: data.bank_iban,
      bank_bic: data.bank_bic,
      first_name: data.first_name,
      last_name: data.last_name,
      residence_country: data.country,
    });
    if (!audit.valid)
      throw new Error(`payout_invalid:${audit.issues.map((i) => i.code).join(",")}`);

    const dti = debtRatio(
      pricing.totalMonthly,
      data.monthly_income + (data.other_income ?? 0),
      data.monthly_charges,
    );
    const complianceFlags = audit.issues.map((i) => ({
      field: i.field,
      code: i.code,
      severity: i.severity,
    }));
    if (dti !== null && dti > 40) {
      complianceFlags.push({ field: "bank_iban", code: "risk.dtiAbove40", severity: "warning" });
    }

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
      bank_country: ibanCountry(data.bank_iban),
      consent_terms: data.consent_terms,
      consent_privacy: data.consent_privacy,
      consent_marketing: data.consent_marketing ?? false,
      current_step: 6,
      submitted_at: new Date().toISOString(),
      created_ip: ip,
      monthly_payment: pricing.monthlyPayment,
      insurance_monthly: pricing.insuranceMonthly,
      total_interest: pricing.totalInterest,
      total_cost: pricing.totalCost,
      apr: pricing.apr,
      fees: pricing.fees,
      dti_percent: dti,
      kyc_status: "pending",
      compliance_flags: complianceFlags,
      review_required: complianceFlags.length > 0,
    };

    const { data: inserted, error } = await supabaseAdmin
      .from("loan_applications")
      .insert(applicationPayload as never)
      .select("id, reference, status, created_at")
      .single();

    if (error) throw new Error(error.message);

    const token = await server.issuePortalToken(inserted.id);

    // Les effets de bord (journal, notification, email) ne doivent jamais
    // faire échouer une demande déjà enregistrée : on les isole et on les
    // journalise côté serveur pour diagnostic.
    try {
      await server.logEvent(inserted.id, "application_submitted", {
        description: "Demande soumise par le demandeur",
        metadata: {
          amount,
          months,
          product: product.slug,
          monthly: pricing.totalMonthly,
          apr: pricing.apr,
          dti,
          flags: complianceFlags,
        },
        ip,
      });

      const workflow = await import("@/lib/workflow.server");
      await workflow.notifyAdmins({
        title: inserted.reference,
        message: `Nouvelle demande · ${amount} ${product.currency}`,
        link: `/admin/applications/${inserted.id}`,
        category: "application",
      });
      await workflow.queueEmail({
        applicationId: inserted.id,
        to: applicationPayload.email,
        locale: data.language,
        template: "applicationReceived",
        vars: { reference: inserted.reference, firstName: data.first_name, reason: "" },
      });
    } catch (sideEffectError) {
      console.error("[submitApplication] post-insert side effect failed", sideEffectError);
    }

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
              file_size: z.coerce
                .number()
                .int()
                .min(1)
                .max(25 * 1024 * 1024),
              /** Preuve de capture produite par le navigateur, revalidée ici. */
              capture_evidence: z.unknown().optional(),
              /** Lecture OCR/MRZ produite par le navigateur (texte brut). */
              ocr: z.unknown().optional(),
              /** Imagette du visage (pièce ou vivacité) : pixels uniquement,
               *  jamais un verdict. La comparaison est faite ici. */
              face: z
                .object({
                  image_base64: z.string().max(700_000).optional(),
                  faces_detected: z.number().int().min(0).max(50).optional(),
                  face_size_px: z.number().min(0).max(10_000).optional(),
                  source: z.enum(["document", "live"]).optional(),
                })
                .optional(),
            }),
          )
          .min(1)
          .max(24),
        /** Identité déclarée au formulaire, croisée avec la MRZ lue. */
        identity: z
          .object({
            first_name: z.string().max(120).optional(),
            last_name: z.string().max(120).optional(),
            birth_date: z.string().max(40).optional(),
            nationality: z.string().max(3).optional(),
          })
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const server = await import("@/lib/applications.server");
    const { verifyCaptureEvidence } = await import("@/lib/kyc/evidence.server");

    const applicationId = await server.resolveToken(data.token);
    if (!applicationId) throw new Error("invalid_token");

    /* Revalidation serveur des preuves : les mesures du navigateur ne sont
     * jamais reprises telles quelles, elles sont bornées puis confrontées aux
     * mêmes seuils qu'à l'écran. Le verdict pilote le statut du contrôle KYC. */
    const verdicts = new Map<string, ReturnType<typeof verifyCaptureEvidence>>();
    const ocrByPath = new Map<string, unknown>();
    // Les imagettes de visage servent uniquement à la comparaison faite plus
    // bas : elles ne sont ni écrites en base ni conservées après la décision.
    const faceByPath = new Map<string, NonNullable<(typeof data.documents)[number]["face"]>>();
    const rows = data.documents
      .filter((d) => d.storage_path.startsWith(`${applicationId}/`))
      .map((d) => {
        const { capture_evidence, ocr, face, ...doc } = d;
        if (ocr) ocrByPath.set(d.storage_path, ocr);
        if (face?.image_base64) faceByPath.set(d.storage_path, face);
        const verdict = verifyCaptureEvidence(capture_evidence);
        verdicts.set(d.storage_path, verdict);
        return {
          ...doc,
          application_id: applicationId,
          capture_method: verdict.evidence ? verdict.method : null,
          capture_evidence: (verdict.evidence ?? null) as never,
        };
      });
    if (rows.length === 0) throw new Error("invalid_path");

    /* ------------------------------------------------------------------
     * REMPLACEMENT DE PIÈCE — périmètre strictement limité.
     *
     * Une pièce n'est remplacée (l'ancienne version disparaît réellement du
     * dossier et du stockage) QUE lorsque le back-office a explicitement
     * demandé un remplacement pour ce type de pièce, c'est-à-dire :
     *   - une demande `application_info_requests` ouverte de type
     *     `replace_document` portant ce `document_type_slug` ; ou
     *   - une pièce déjà déposée de ce type marquée
     *     `replacement_requested` lors de la revue documentaire.
     *
     * Tous les autres dépôts (pièce manquante, complément, nouvelle
     * catégorie, pièce alternative) restent CUMULATIFS : rien n'est supprimé.
     * ---------------------------------------------------------------- */
    const uploadedSlugs = [...new Set(rows.map((r) => r.document_type_slug))];

    const [{ data: replaceRequests }, { data: existingDocs }] = await Promise.all([
      supabaseAdmin
        .from("application_info_requests")
        .select("id, document_type_slug")
        .eq("application_id", applicationId)
        .eq("kind", "replace_document")
        .eq("status", "open")
        .in("document_type_slug", uploadedSlugs),
      supabaseAdmin
        .from("application_documents")
        .select("id, document_type_slug, status, storage_path")
        .eq("application_id", applicationId)
        .in("document_type_slug", uploadedSlugs),
    ]);

    const replaceSlugs = new Set<string>();
    for (const r of replaceRequests ?? []) {
      const slug = (r as { document_type_slug?: string | null }).document_type_slug;
      if (slug) replaceSlugs.add(slug);
    }
    for (const d of existingDocs ?? []) {
      if ((d as { status?: string | null }).status === "replacement_requested") {
        replaceSlugs.add(d.document_type_slug);
      }
    }

    const { data: insertedDocs, error } = await supabaseAdmin
      .from("application_documents")
      .insert(rows)
      .select("id, document_type_slug, storage_path");
    if (error) throw new Error(error.message);

    // Purge des versions précédentes UNIQUEMENT pour les pièces réellement
    // en remplacement. L'ordre compte : la nouvelle version est déjà en base,
    // le dossier ne peut donc jamais se retrouver sans pièce.
    const supersededDocs = (existingDocs ?? []).filter((d) =>
      replaceSlugs.has(d.document_type_slug),
    );
    if (supersededDocs.length > 0) {
      const supersededIds = supersededDocs.map((d) => d.id);
      const paths = supersededDocs
        .map((d) => (d as { storage_path?: string | null }).storage_path)
        .filter((p): p is string => Boolean(p));

      // Trace KYC de l'ancienne version : supprimée avec elle (append-only
      // conservé côté journal d'activité ci-dessous).
      await supabaseAdmin.from("application_kyc_checks").delete().in("document_id", supersededIds);
      await supabaseAdmin
        .from("application_documents")
        .delete()
        .eq("application_id", applicationId)
        .in("id", supersededIds);
      if (paths.length > 0) {
        await supabaseAdmin.storage.from("kyc-documents").remove(paths);
      }

      // Les demandes de remplacement satisfaites sont clôturées : le client ne
      // voit plus une demande déjà honorée.
      const satisfied = (replaceRequests ?? [])
        .filter((r) => {
          const slug = (r as { document_type_slug?: string | null }).document_type_slug;
          return slug ? uploadedSlugs.includes(slug) : false;
        })
        .map((r) => r.id);
      if (satisfied.length > 0) {
        await supabaseAdmin
          .from("application_info_requests")
          .update({
            status: "answered",
            responded_at: new Date().toISOString(),
          } as never)
          .in("id", satisfied);
      }

      await server.logEvent(applicationId, "document_replaced", {
        actor: "applicant",
        description: `Remplacement de ${supersededDocs.length} pièce(s)`,
        metadata: {
          slugs: [...replaceSlugs],
          removed_documents: supersededIds,
        },
      });
    }

    // Mirror every uploaded piece into the KYC verification trail so the
    // compliance officer sees one auditable row per check.
    const { data: types } = await supabaseAdmin
      .from("document_types")
      .select("slug, category")
      .in(
        "slug",
        rows.map((r) => r.document_type_slug),
      );
    const categoryOf = new Map(
      (types ?? []).map((t) => [t.slug, (t as { category?: string }).category ?? "other"]),
    );

    const checks = (insertedDocs ?? []).map((doc) => {
      const verdict = verdicts.get((doc as { storage_path?: string }).storage_path ?? "");
      return {
        application_id: applicationId,
        step_key: `${categoryOf.get(doc.document_type_slug) ?? "other"}:${doc.document_type_slug}`,
        category: categoryOf.get(doc.document_type_slug) ?? "other",
        document_type_slug: doc.document_type_slug,
        document_id: doc.id,
        // Une preuve jugée irrecevable côté serveur échoue immédiatement ;
        // tout le reste reste en vérification pour la revue de conformité.
        status: verdict?.status === "failed" ? "failed" : "verifying",
        provider: verdict?.provider ?? "manual",
        method: verdict?.evidence ? verdict.method : null,
        evidence: (verdict?.evidence ?? null) as never,
        reasons: verdict?.reasons ?? [],
        score: verdict?.score ?? null,
      };
    });
    if (checks.length > 0) {
      await supabaseAdmin.from("application_kyc_checks").insert(checks as never);
      await supabaseAdmin
        .from("loan_applications")
        .update({ kyc_status: "verifying", kyc_completed_at: new Date().toISOString() } as never)
        .eq("id", applicationId);
    }

    await server.logEvent(applicationId, "documents_uploaded", {
      description: `${rows.length} document(s) déposé(s)`,
      metadata: {
        types: rows.map((r) => r.document_type_slug),
        // Piste d'audit : mode de capture réel et anomalies relevées.
        capture: [...verdicts.values()].map((v) => ({
          method: v.method,
          provider: v.provider,
          status: v.status,
          reasons: v.reasons,
        })),
      },
    });
    /* ------------------------------------------------------------------
     * DÉCISION KYC FINALE — OCR/MRZ, croisement, arbitrage.
     *
     * La MRZ transmise par le navigateur n'est jamais reprise décodée : le
     * texte brut est re-parsé ici, ses clés de contrôle revérifiées, puis
     * croisé avec l'identité déclarée. La décision (passed / manual_review /
     * failed) est journalisée et reportée sur le dossier.
     * ---------------------------------------------------------------- */
    try {
      const { decideKyc } = await import("@/lib/kyc/decision.server");
      const { parseMrz } = await import("@/lib/kyc/mrz");

      const docsForDecision = (insertedDocs ?? []).map((doc) => {
        const path = (doc as { storage_path?: string }).storage_path ?? "";
        const verdict = verdicts.get(path);
        return {
          document_type_slug: doc.document_type_slug,
          category: categoryOf.get(doc.document_type_slug) ?? "other",
          capture_status: (verdict?.status ?? "verifying") as
            | "verifying"
            | "passed"
            | "manual_review"
            | "failed",
          capture_reasons: verdict?.reasons ?? [],
          capture_score: verdict?.score ?? null,
          capture_method: (verdict?.method ?? "upload") as "scan" | "upload" | "liveness",
          ocr: ocrByPath.get(path),
        };
      });

      // Seule l'identité du dossier fait foi. Un dépôt ne peut pas la remplacer.
      const { data: application, error: identityError } = await supabaseAdmin
        .from("loan_applications")
        .select("first_name, last_name, birth_date, nationality")
        .eq("id", applicationId)
        .maybeSingle();

      if (identityError || !application) throw new Error("kyc_identity_unavailable");
      const declared = application;

      /* CORRESPONDANCE FACIALE — pièce d'identité ↔ contrôle de vivacité.
       * Le moteur biométrique interne (worker, descripteurs 128D) prime dès
       * qu'il a réellement comparé ce dossier ; à défaut, la comparaison est
       * calculée ici sur les imagettes déposées. Le seuil est serveur : le
       * navigateur n'a transmis que des pixels. */
      const { compareFaces, faceMatchFromWorkerResult, resolveFaceMatch } =
        await import("@/lib/kyc/face-compare.server");

      let documentFace: ReturnType<typeof faceByPath.get>;
      let liveFace: ReturnType<typeof faceByPath.get>;
      for (const doc of insertedDocs ?? []) {
        const path = (doc as { storage_path?: string }).storage_path ?? "";
        const face = faceByPath.get(path);
        if (!face) continue;
        const category = categoryOf.get(doc.document_type_slug) ?? "other";
        if (!documentFace && category === "identity") documentFace = face;
        if (!liveFace && (category === "selfie" || verdicts.get(path)?.method === "liveness"))
          liveFace = face;
      }

      const { data: faceJob } = await (
        supabaseAdmin.from as unknown as (t: string) => {
          select: (c: string) => {
            eq: (
              c: string,
              v: string,
            ) => {
              eq: (
                c: string,
                v: string,
              ) => {
                maybeSingle: () => Promise<{ data: { result?: unknown } | null }>;
              };
            };
          };
        }
      )("application_kyc_face_jobs")
        .select("result")
        .eq("application_id", applicationId)
        .eq("kind", "face_match")
        .maybeSingle();

      const faceMatch = resolveFaceMatch(
        faceMatchFromWorkerResult(faceJob?.result),
        documentFace || liveFace ? await compareFaces(documentFace, liveFace) : null,
      );

      const result = decideKyc({ declared, documents: docsForDecision, faceMatch });

      // Lecture MRZ conservée avec la pièce qui l'a portée.
      for (const doc of insertedDocs ?? []) {
        const path = (doc as { storage_path?: string }).storage_path ?? "";
        const payload = ocrByPath.get(path);
        if (!payload) continue;
        const raw = payload as { mrz_text?: string; viz_text?: string; confidence?: number };
        const parsed = parseMrz(`${raw.mrz_text ?? ""}\n${raw.viz_text ?? ""}`);
        await supabaseAdmin
          .from("application_documents")
          .update({
            ocr_mrz: parsed
              ? ({
                  format: parsed.format,
                  document_code: parsed.document_code,
                  issuing_state: parsed.issuing_state,
                  document_number: parsed.document_number,
                  surname: parsed.surname,
                  given_names: parsed.given_names,
                  nationality: parsed.nationality,
                  birth_date: parsed.birth_date,
                  expiry_date: parsed.expiry_date,
                  sex: parsed.sex,
                  checksums_valid: parsed.checksums_valid,
                  checksum_ratio: parsed.checksum_ratio,
                  checks: parsed.checks,
                } as never)
              : null,
            ocr_confidence: typeof raw.confidence === "number" ? raw.confidence : null,
          } as never)
          .eq("id", doc.id);
      }

      const { error: decisionWriteError } = await (
        supabaseAdmin.from as unknown as (t: string) => {
          insert: (v: unknown) => Promise<{ error: unknown }>;
        }
      )("application_identity_decisions").insert({
        application_id: applicationId,
        decision: result.decision,
        score: result.score,
        reasons: result.reasons,
        identity_match: (result.identity ?? null) as never,
        mrz: (result.mrz ?? null) as never,
        source_document: result.source_document,
        ocr_confidence: result.ocr.confidence,
        engine: result.ocr.engine,
        // Piste d'audit de la comparaison faciale : résultat, seuil appliqué,
        // moteur et version. Aucun descripteur biométrique n'est conservé.
        face_match: (result.face_match ?? null) as never,
        face_match_status: result.face_match?.band ?? "not_compared",
        face_similarity: result.face_match?.similarity ?? null,
        face_threshold: result.face_match?.threshold ?? null,
        face_engine: result.face_match?.engine ?? null,
        face_engine_version: result.face_match?.engine_version ?? null,
        thresholds: result.thresholds as never,
        decided_by: "server",
      } as never);

      if (decisionWriteError) throw new Error("kyc_audit_write_failed");
      const { error: statusWriteError } = await supabaseAdmin
        .from("loan_applications")
        .update({
          kyc_decision: result.decision,
          kyc_decision_score: result.score,
          kyc_decided_at: result.evaluated_at,
          // Le statut global ne passe jamais à "passed" sur la seule machine :
          // une décision positive reste "verifying" tant que la conformité n'a
          // pas confirmé, une décision négative est immédiatement visible.
          kyc_status: result.decision === "failed" ? "failed" : "verifying",
        } as never)
        .eq("id", applicationId);

      if (statusWriteError) throw new Error("kyc_status_write_failed");
      await server.logEvent(applicationId, "kyc_decision", {
        description: `Décision KYC automatique : ${result.decision} (${result.score}/100)`,
        metadata: {
          decision: result.decision,
          score: result.score,
          reasons: result.reasons,
          source_document: result.source_document,
          mrz_found: result.ocr.mrz_found,
          ocr_confidence: result.ocr.confidence,
          face_match_status: result.face_match?.band ?? "not_compared",
          face_similarity: result.face_match?.similarity ?? null,
          face_threshold: result.face_match?.threshold ?? null,
          face_engine: result.face_match
            ? `${result.face_match.engine}@${result.face_match.engine_version}`
            : null,
          thresholds_version: result.thresholds.version,
        },
      });

      // Le navigateur ne reçoit que la décision. Le score et les motifs
      // machine restent en base et dans la piste d'audit, à l'usage exclusif
      // du service conformité.
      return { ok: true, count: rows.length, decision: result.decision };
    } catch (decisionError) {
      // Les fichiers sont déposés, mais aucune décision ne doit être inventée.
      console.error("[registerDocuments] kyc decision failed", decisionError);
      throw new Error("kyc_assessment_unavailable");
    }

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

    const [{ data: application }, { data: history }, { data: documents }, { data: kycChecks }] =
      await Promise.all([
        supabaseAdmin.from("loan_applications").select("*").eq("id", applicationId).maybeSingle(),
        supabaseAdmin
          .from("application_status_history")
          .select("new_status, created_at, note, reason")
          .eq("application_id", applicationId)
          .order("created_at", { ascending: true }),
        supabaseAdmin
          .from("application_documents")
          .select("id, document_type_slug, file_name, status, review_note, created_at")
          .eq("application_id", applicationId)
          .order("created_at", { ascending: true }),
        supabaseAdmin
          .from("application_kyc_checks")
          .select(
            "id, step_key, category, document_type_slug, status, review_note, reviewed_at, created_at",
          )
          .eq("application_id", applicationId)
          .order("created_at", { ascending: true }),
      ]);

    if (!application) return null;

    const { data: product } = application.product_id
      ? await supabaseAdmin
          .from("loan_products")
          .select(
            "slug, name, i18n_key, currency, annual_rate, insurance_monthly_rate, fee_fixed, fee_percent",
          )
          .eq("id", application.product_id)
          .maybeSingle()
      : { data: null };

    const [
      { data: infoRequests },
      { data: offer },
      { data: contract },
      { data: guarantee },
      { data: insurance },
      { data: disbursement },
      { data: repayments },
    ] = await Promise.all([
      supabaseAdmin
        .from("application_info_requests")
        .select(
          "id, kind, message, status, document_type_slug, response_text, responded_at, created_at",
        )
        .eq("application_id", applicationId)
        .neq("status", "cancelled")
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("application_offers")
        .select(
          "id, amount, duration_months, annual_rate, monthly_payment, total_cost, insurance_total, fees_total, currency, valid_until, accepted_at, declined_at, created_at",
        )
        .eq("application_id", applicationId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from("application_contracts")
        .select(
          "id, language, sent_at, signed_at, signature_name, signature_method, storage_path, signed_storage_path",
        )
        .eq("application_id", applicationId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from("application_guarantees")
        .select(
          "id, kind, guarantor_name, amount, currency, status, sent_at, signed_at, fee_amount, fee_description, payment_instructions, payment_status, client_choice, choice_at, scheduled_payment_date, payment_validated_at, storage_path, signed_storage_path, document_version, document_hash, signed_document_hash",
        )
        .eq("application_id", applicationId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from("application_insurances")
        .select(
          "id, provider, policy_number, coverage, monthly_premium, currency, status, starts_on, due_date, validated_at, sent_at, signed_at, fee_amount, fee_description, payment_instructions, payment_status, client_choice, choice_at, scheduled_payment_date, payment_validated_at, storage_path, signed_storage_path, document_version, document_hash, signed_document_hash",
        )
        .eq("application_id", applicationId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from("disbursements")
        .select(
          "id, amount, currency, beneficiary, iban, bank_name, reference, status, processed_at, created_at",
        )
        .eq("application_id", applicationId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from("repayment_schedule")
        .select(
          "id, installment_no, due_date, amount, principal, interest, insurance, remaining_balance, paid, paid_at",
        )
        .eq("application_id", applicationId)
        .order("installment_no", { ascending: true })
        .limit(360),
    ]);

    return {
      application,
      product,
      history: history ?? [],
      documents: documents ?? [],
      kycChecks: kycChecks ?? [],
      infoRequests: infoRequests ?? [],
      offer,
      contract: contract
        ? {
            id: contract.id,
            language: contract.language,
            sent_at: contract.sent_at,
            signed_at: contract.signed_at,
            signature_name: contract.signature_name,
            signature_method: contract.signature_method,
            has_document: Boolean(contract.storage_path),
            has_signed_document: Boolean(contract.signed_storage_path),
          }
        : null,
      guarantee: guarantee
        ? {
            ...guarantee,
            has_document: Boolean(guarantee.storage_path),
            has_signed_document: Boolean(guarantee.signed_storage_path),
          }
        : null,
      insurance: insurance
        ? {
            ...insurance,
            has_document: Boolean(insurance.storage_path),
            has_signed_document: Boolean(insurance.signed_storage_path),
          }
        : null,
      disbursement: disbursement
        ? { ...disbursement, iban: server.maskIban(disbursement.iban) }
        : null,
      repayments: repayments ?? [],
    };
  });

/**
 * Lien de téléchargement temporaire pour une pièce du dossier.
 * Le document n'est jamais accessible par son nom : le token doit
 * correspondre au dossier propriétaire, et chaque accès est journalisé.
 */
export const getSecureDocumentUrl = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        token: z.string().min(20).max(200),
        kind: z
          .enum([
            "document",
            "contract",
            "signed_contract",
            "guarantee",
            "signed_guarantee",
            "insurance",
            "signed_insurance",
          ])
          .default("document"),
        document_id: z.string().uuid().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const server = await import("@/lib/applications.server");

    const applicationId = await server.resolveToken(data.token);
    if (!applicationId) throw new Error("invalid_token");

    const ip =
      getRequestHeader("cf-connecting-ip") ??
      getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim() ??
      null;
    if (!server.rateLimit(`doc:${applicationId}`, 60, 10 * 60 * 1000))
      throw new Error("rate_limited");

    let bucket = "kyc-documents";
    let path: string | null = null;

    if (data.kind === "document") {
      if (!data.document_id) throw new Error("missing_document");
      const { data: doc } = await supabaseAdmin
        .from("application_documents")
        .select("storage_path, application_id")
        .eq("id", data.document_id)
        .eq("application_id", applicationId)
        .maybeSingle();
      path = doc?.storage_path ?? null;
    } else if (data.kind === "contract" || data.kind === "signed_contract") {
      bucket = "contracts";
      const { data: contract } = await supabaseAdmin
        .from("application_contracts")
        .select("storage_path, signed_storage_path")
        .eq("application_id", applicationId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      path =
        (data.kind === "signed_contract"
          ? contract?.signed_storage_path
          : contract?.storage_path) ?? null;
    } else {
      bucket = "contracts";
      const isGuarantee = data.kind === "guarantee" || data.kind === "signed_guarantee";
      const table = isGuarantee ? "application_guarantees" : "application_insurances";
      const { data: artifact } = await supabaseAdmin
        .from(table)
        .select("storage_path, signed_storage_path")
        .eq("application_id", applicationId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const signedKind = data.kind === "signed_guarantee" || data.kind === "signed_insurance";
      path = (signedKind ? artifact?.signed_storage_path : artifact?.storage_path) ?? null;
    }

    if (!path) throw new Error("not_found");

    const { data: signed, error } = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUrl(path, 120);
    if (error || !signed?.signedUrl) throw new Error("signing_failed");

    await server.logEvent(applicationId, "document_accessed", {
      actor: "applicant",
      description: data.kind,
      metadata: { kind: data.kind, document_id: data.document_id ?? null, bucket },
      ip,
    });

    return { url: signed.signedUrl, expiresIn: 120 };
  });

/** Réponse du demandeur à une demande d'information, via le lien sécurisé. */
export const respondToInfoRequest = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        token: z.string().min(20).max(200),
        request_id: z.string().uuid(),
        response: z.string().min(2).max(2000),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const server = await import("@/lib/applications.server");
    const { notifyAdmins } = await import("@/lib/workflow.server");

    const applicationId = await server.resolveToken(data.token);
    if (!applicationId) throw new Error("invalid_token");

    const { data: updated, error } = await supabaseAdmin
      .from("application_info_requests")
      .update({
        response_text: data.response,
        responded_at: new Date().toISOString(),
        status: "answered",
      } as never)
      .eq("id", data.request_id)
      .eq("application_id", applicationId)
      .eq("status", "open")
      .select("id, kind")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!updated) throw new Error("request_not_open");

    await server.logEvent(applicationId, "info_request_answered", {
      actor: "applicant",
      description: data.response.slice(0, 500),
      metadata: { request_id: data.request_id },
    });

    const { data: app } = await supabaseAdmin
      .from("loan_applications")
      .select("reference")
      .eq("id", applicationId)
      .maybeSingle();
    await notifyAdmins({
      title: app?.reference ?? "Dossier",
      message: "Réponse du demandeur à une demande d'information",
      link: `/admin/applications/${applicationId}`,
      category: "application",
    });

    return { ok: true };
  });
