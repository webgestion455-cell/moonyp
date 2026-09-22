/**
 * Demandes de vérification d'identité externes — fonctions serveur.
 *
 * Côté administration : création, consultation et révocation, protégées par
 * le RBAC existant (permission « kyc.review »).
 * Côté client externe : résolution du lien, dépôt des pièces et
 * enregistrement final. Le navigateur n'écrit jamais de statut : le serveur
 * revalide le jeton à chaque opération et rend seul la décision.
 */

import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  employmentSchema,
  identitySchema,
  payoutSchema,
} from "@/lib/application-schema";

const SUPPORTED_CODES = [
  "en",
  "fr",
  "de",
  "es",
  "it",
  "nl",
  "sl",
  "bg",
  "sk",
  "el",
  "fi",
  "ro",
  "pl",
  "hr",
  "hu",
] as const;

async function assertKycStaff(
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }> },
  userId: string,
) {
  const { data } = await supabase.rpc("has_permission", {
    _user_id: userId,
    _permission: "kyc.review",
  });
  if (data !== true) throw new Error("forbidden");
}

/* -------------------------------------------------------------------------- */
/*                               Administration                               */
/* -------------------------------------------------------------------------- */

export const adminListKycRequests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertKycStaff(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { effectiveStatus } = await import("@/lib/kyc-requests.server");

    const { data, error } = await supabaseAdmin
      .from("kyc_verification_requests")
      .select(
        "id, reference, full_name, email, phone, language, status, expires_at, created_at, completed_at, revoked_at, last_accessed_at, kyc_decision, application_id",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);

    return (data ?? []).map((row) => ({
      ...row,
      // Statut réel : calculé ici, l'expiration n'est jamais déduite au navigateur.
      effective_status: effectiveStatus(row),
    }));
  });

export const adminCreateKycRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        full_name: z.string().trim().min(2).max(160),
        email: z.string().trim().email().max(255),
        phone: z.string().trim().max(32).optional().default(""),
        language: z.enum(SUPPORTED_CODES),
        expires_in_hours: z.coerce.number().int().min(1).max(24 * 90),
        partner_note: z.string().trim().max(500).optional().default(""),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertKycStaff(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { generateKycToken, hashKycToken } = await import("@/lib/kyc-requests.server");

    const token = generateKycToken();
    const expiresAt = new Date(Date.now() + data.expires_in_hours * 3600 * 1000).toISOString();

    const { data: inserted, error } = await supabaseAdmin
      .from("kyc_verification_requests")
      .insert({
        full_name: data.full_name,
        email: data.email.toLowerCase(),
        phone: data.phone || null,
        language: data.language,
        token_hash: hashKycToken(token),
        expires_at: expiresAt,
        created_by: context.userId,
        partner_note: data.partner_note || null,
      } as never)
      .select("id, reference, language, expires_at")
      .single();
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("activity_logs").insert({
      actor_id: context.userId,
      action: "kyc_request_created",
      entity: "kyc_verification_requests",
      entity_id: inserted.id,
      metadata: { reference: inserted.reference, language: data.language } as never,
    } as never);

    // Le jeton en clair n'est renvoyé qu'ici, une seule fois.
    return { ...inserted, token };
  });

export const adminRevokeKycRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertKycStaff(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin
      .from("kyc_verification_requests")
      .update({ status: "revoked", revoked_at: new Date().toISOString() } as never)
      .eq("id", data.id)
      .neq("status", "completed");
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("activity_logs").insert({
      actor_id: context.userId,
      action: "kyc_request_revoked",
      entity: "kyc_verification_requests",
      entity_id: data.id,
      metadata: {} as never,
    } as never);

    return { ok: true };
  });

/* -------------------------------------------------------------------------- */
/*                              Parcours client                               */
/* -------------------------------------------------------------------------- */

const tokenSchema = z.string().min(20).max(200);

/** Ce que le porteur du lien peut voir. Aucune donnée interne n'est exposée. */
export const resolveKycRequest = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ token: tokenSchema }).parse(input))
  .handler(async ({ data }) => {
    const { findKycRequestByToken, effectiveStatus, touchKycRequest } = await import(
      "@/lib/kyc-requests.server"
    );

    const row = await findKycRequestByToken(data.token);
    if (!row) return { ok: false as const, reason: "invalid" as const };

    const status = effectiveStatus(row);
    if (status !== "pending" && status !== "in_progress") {
      return { ok: false as const, reason: status };
    }

    await touchKycRequest(row.id, status === "pending" ? { status: "in_progress" } : {});

    return {
      ok: true as const,
      reference: row.reference,
      full_name: row.full_name,
      email: row.email,
      phone: row.phone,
      language: row.language,
      expires_at: row.expires_at,
    };
  });

/** URL de dépôt signée, cloisonnée au dossier de la demande. */
export const createKycRequestUploadUrl = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        token: tokenSchema,
        document_type_slug: z.string().min(1).max(60),
        file_name: z.string().min(1).max(255),
        mime_type: z.string().min(1).max(120),
        file_size: z.coerce.number().int().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { requireUsableKycRequest } = await import("@/lib/kyc-requests.server");

    const request = await requireUsableKycRequest(data.token);

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
    const path = `kyc-requests/${request.id}/${data.document_type_slug}/${Date.now()}-${safeName}`;

    const { data: signed, error } = await supabaseAdmin.storage
      .from("kyc-documents")
      .createSignedUploadUrl(path);
    if (error) throw new Error(error.message);

    return { path, token: signed.token, signedUrl: signed.signedUrl };
  });

/**
 * Enregistrement final : informations saisies, pièces déposées, décision.
 * Aucune demande de prêt n'est créée, aucun compte n'est ouvert.
 */
export const submitKycRequest = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        token: tokenSchema,
        profile: identitySchema.merge(employmentSchema).merge(payoutSchema),
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
              capture_evidence: z.unknown().optional(),
              ocr: z.unknown().optional(),
            }),
          )
          .min(1)
          .max(24),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { requireUsableKycRequest } = await import("@/lib/kyc-requests.server");
    const { rateLimit } = await import("@/lib/applications.server");
    const { verifyCaptureEvidence } = await import("@/lib/kyc/evidence.server");
    const { decideKyc } = await import("@/lib/kyc/decision.server");
    const { parseMrz } = await import("@/lib/kyc/mrz");

    const ip =
      getRequestHeader("cf-connecting-ip") ??
      getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim() ??
      null;
    if (!rateLimit(`kyc-request:${ip ?? "unknown"}`, 10, 10 * 60 * 1000)) {
      throw new Error("rate_limited");
    }

    const request = await requireUsableKycRequest(data.token);

    // Les fichiers doivent appartenir au dossier de cette demande.
    const prefix = `kyc-requests/${request.id}/`;
    const captures = data.documents.filter((d) => d.storage_path.startsWith(prefix));
    if (captures.length === 0) throw new Error("invalid_path");

    const { data: types } = await supabaseAdmin
      .from("document_types")
      .select("slug, category")
      .in(
        "slug",
        captures.map((c) => c.document_type_slug),
      );
    const categoryOf = new Map(
      (types ?? []).map((t) => [t.slug, (t as { category?: string }).category ?? "other"]),
    );

    const prepared = captures.map((capture) => {
      const verdict = verifyCaptureEvidence(capture.capture_evidence);
      const raw = (capture.ocr ?? null) as {
        mrz_text?: string;
        viz_text?: string;
        confidence?: number;
      } | null;
      const parsed = raw ? parseMrz(`${raw.mrz_text ?? ""}\n${raw.viz_text ?? ""}`) : null;

      return {
        row: {
          request_id: request.id,
          document_type_slug: capture.document_type_slug,
          storage_path: capture.storage_path,
          file_name: capture.file_name,
          mime_type: capture.mime_type,
          file_size: capture.file_size,
          category: categoryOf.get(capture.document_type_slug) ?? "other",
          capture_method: verdict.evidence ? verdict.method : null,
          capture_evidence: (verdict.evidence ?? null) as never,
          ocr_mrz: (parsed ?? null) as never,
          ocr_confidence: typeof raw?.confidence === "number" ? raw.confidence : null,
          status: verdict.status === "failed" ? "failed" : "verifying",
          reasons: (verdict.reasons ?? []) as never,
          score: verdict.score ?? null,
        },
        decision: {
          document_type_slug: capture.document_type_slug,
          category: categoryOf.get(capture.document_type_slug) ?? "other",
          capture_status: verdict.status,
          capture_reasons: verdict.reasons,
          capture_score: verdict.score,
          capture_method: (verdict.method ?? "upload") as "scan" | "upload" | "liveness",
          ocr: capture.ocr,
        },
      };
    });

    const { error: docError } = await supabaseAdmin
      .from("kyc_verification_documents")
      .insert(prepared.map((p) => p.row) as never);
    if (docError) throw new Error(docError.message);

    // Identité opposable : celle saisie dans ce parcours, revalidée ici.
    const result = decideKyc({
      declared: {
        first_name: data.profile.first_name,
        last_name: data.profile.last_name,
        birth_date: data.profile.birth_date,
        nationality: data.profile.nationality ?? "",
      },
      documents: prepared.map((p) => p.decision),
    });

    const { error: updateError } = await supabaseAdmin
      .from("kyc_verification_requests")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        collected: data.profile as never,
        kyc_decision: result.decision,
        kyc_score: result.score,
        kyc_reasons: result.reasons as never,
        kyc_decided_at: result.evaluated_at,
      } as never)
      .eq("id", request.id)
      .eq("status", "in_progress");
    if (updateError) throw new Error(updateError.message);

    try {
      const { notifyAdmins } = await import("@/lib/workflow.server");
      await notifyAdmins({
        title: request.reference,
        message: "Vérification d'identité externe terminée",
        link: "/admin/kyc-requests",
        category: "application",
      });
    } catch (sideEffect) {
      console.error("[submitKycRequest] notification failed", sideEffect);
    }

    // Le navigateur ne reçoit que la référence : ni score, ni motifs machine.
    return { ok: true as const, reference: request.reference };
  });
