/**
 * SignatureService — abstraction de signature électronique.
 *
 * Le produit ne prétend PAS fournir une signature électronique qualifiée :
 * le fournisseur interne implémente une signature *avancée légère* (AES-like)
 * fondée sur un code à usage unique envoyé au demandeur, l'horodatage,
 * l'adresse IP, l'agent utilisateur et l'empreinte SHA-256 du document.
 *
 * Brancher un prestataire qualifié (eIDAS QES, BankID, itsme, Freja…) consiste
 * uniquement à enregistrer un nouvel objet `SignatureProvider` dans `PROVIDERS`
 * puis à le sélectionner via la variable d'environnement SIGNATURE_PROVIDER.
 */
import { createHash } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { generateOtp, hashToken, logEvent } from "@/lib/applications.server";

export interface SignerContext {
  applicationId: string;
  contractId: string;
  signerName: string | null;
  signerEmail: string | null;
  locale: string | null;
  ip: string | null;
  userAgent: string | null;
}

export interface CreatedRequest {
  providerReference: string;
  /** Défi à relever par le signataire côté client. */
  challenge: "otp" | "redirect" | "none";
  /** URL du prestataire externe lorsque le défi est une redirection. */
  redirectUrl?: string | null;
  expiresAt: string;
  /** Secret à transmettre au signataire hors bande (email). */
  outOfBandCode?: string | null;
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
  evidence: Record<string, unknown>;
}

export interface SignatureProvider {
  id: string;
  label: string;
  /** true uniquement pour un prestataire réellement qualifié eIDAS. */
  qualified: boolean;
  /** Pays couverts ("*" = tous). */
  countries: "*" | string[];
  createRequest(ctx: SignerContext): Promise<CreatedRequest>;
  verify(input: {
    requestId: string;
    ctx: SignerContext;
    code?: string | null;
    documentHash: string | null;
  }): Promise<VerifyResult>;
}

const OTP_TTL_MINUTES = 15;

/** Fournisseur intégré : code à usage unique + faisceau de preuves. */
const internalProvider: SignatureProvider = {
  id: "internal_aes",
  label: "Moonyp e-Sign (advanced)",
  qualified: false,
  countries: "*",

  async createRequest(ctx) {
    const code = generateOtp();
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000).toISOString();
    await supabaseAdmin.from("application_otp_codes").insert({
      application_id: ctx.applicationId,
      code_hash: hashToken(code),
      purpose: "contract_signature",
      expires_at: expiresAt,
    } as never);
    return {
      providerReference: `MOONYP-ESIGN-${Date.now().toString(36).toUpperCase()}`,
      challenge: "otp",
      redirectUrl: null,
      expiresAt,
      outOfBandCode: code,
    };
  },

  async verify({ ctx, code, documentHash }) {
    if (!code) return { ok: false, reason: "signature.error.codeRequired", evidence: {} };

    const { data: row } = await supabaseAdmin
      .from("application_otp_codes")
      .select("id, attempts, used, expires_at")
      .eq("application_id", ctx.applicationId)
      .eq("purpose", "contract_signature")
      .eq("code_hash", hashToken(code.trim()))
      .eq("used", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!row) return { ok: false, reason: "signature.error.invalidCode", evidence: {} };
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return { ok: false, reason: "signature.error.expiredCode", evidence: {} };
    }

    await supabaseAdmin
      .from("application_otp_codes")
      .update({ used: true, attempts: (row.attempts ?? 0) + 1 } as never)
      .eq("id", row.id);

    const sealedAt = new Date().toISOString();
    return {
      ok: true,
      evidence: {
        method: "otp_email",
        qualified: false,
        signerName: ctx.signerName,
        signerEmail: ctx.signerEmail,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        documentHash,
        sealedAt,
        seal: createHash("sha256")
          .update([documentHash ?? "", ctx.signerEmail ?? "", ctx.ip ?? "", sealedAt].join("|"))
          .digest("hex"),
      },
    };
  },
};

const PROVIDERS: Record<string, SignatureProvider> = {
  [internalProvider.id]: internalProvider,
};

/** Enregistre un prestataire externe (point d'extension). */
export function registerSignatureProvider(provider: SignatureProvider): void {
  PROVIDERS[provider.id] = provider;
}

/** Sélectionne le prestataire adapté au pays du signataire. */
export function resolveProvider(country?: string | null): SignatureProvider {
  const configured = process.env["SIGNATURE_PROVIDER"];
  if (configured && PROVIDERS[configured]) return PROVIDERS[configured]!;
  if (country) {
    const match = Object.values(PROVIDERS).find(
      (p) => p.countries !== "*" && p.countries.includes(country.toUpperCase()),
    );
    if (match) return match;
  }
  return internalProvider;
}

export async function logSignatureEvent(
  signatureRequestId: string,
  eventType: string,
  options: { actor?: string; ip?: string | null; metadata?: Record<string, unknown> } = {},
): Promise<void> {
  await supabaseAdmin.from("contract_signature_events").insert({
    signature_request_id: signatureRequestId,
    event_type: eventType,
    actor: options.actor ?? "applicant",
    ip: options.ip ?? null,
    metadata: (options.metadata ?? {}) as never,
  } as never);
}

/** Crée (ou réutilise) une demande de signature ouverte pour un contrat. */
export async function createSignatureRequest(ctx: SignerContext, country?: string | null) {
  const provider = resolveProvider(country);
  const created = await provider.createRequest(ctx);

  const { data: row, error } = await supabaseAdmin
    .from("contract_signature_requests")
    .insert({
      application_id: ctx.applicationId,
      contract_id: ctx.contractId,
      provider: provider.id,
      provider_reference: created.providerReference,
      qualified: provider.qualified,
      status: "pending",
      signer_name: ctx.signerName,
      signer_email: ctx.signerEmail,
      signer_ip: ctx.ip,
      signer_user_agent: ctx.userAgent,
      expires_at: created.expiresAt,
    } as never)
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  await logSignatureEvent(row.id, "signature_requested", {
    ip: ctx.ip,
    metadata: { provider: provider.id, qualified: provider.qualified },
  });
  await logEvent(ctx.applicationId, "signature_requested", {
    actor: "applicant",
    description: provider.label,
    metadata: { provider: provider.id, reference: created.providerReference },
    ip: ctx.ip,
  });

  return { id: row.id, provider, created };
}

/** Vérifie le défi et scelle la signature. */
export async function completeSignatureRequest(input: {
  requestId: string;
  ctx: SignerContext;
  code?: string | null;
  documentHash: string | null;
}): Promise<VerifyResult & { provider: SignatureProvider }> {
  const { data: request } = await supabaseAdmin
    .from("contract_signature_requests")
    .select("id, provider, status, expires_at")
    .eq("id", input.requestId)
    .maybeSingle();
  if (!request) throw new Error("signature_request_not_found");

  const provider = PROVIDERS[request.provider] ?? internalProvider;
  if (request.status === "completed") {
    return { ok: true, evidence: {}, provider };
  }

  const result = await provider.verify(input);

  if (!result.ok) {
    await logSignatureEvent(request.id, "signature_failed", {
      ip: input.ctx.ip,
      metadata: { reason: result.reason ?? "unknown" },
    });
    return { ...result, provider };
  }

  await supabaseAdmin
    .from("contract_signature_requests")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      signer_name: input.ctx.signerName,
      signer_ip: input.ctx.ip,
      signer_user_agent: input.ctx.userAgent,
      evidence: result.evidence as never,
    } as never)
    .eq("id", request.id);

  await logSignatureEvent(request.id, "signature_completed", {
    ip: input.ctx.ip,
    metadata: { provider: provider.id, qualified: provider.qualified },
  });

  return { ...result, provider };
}
