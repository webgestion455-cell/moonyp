/**
 * Demandes de vérification d'identité externes — logique serveur.
 *
 * Une demande est autonome : elle ne suppose ni compte Moonyp, ni dossier de
 * prêt. Le lien remis au client ne contient qu'un jeton aléatoire opaque ;
 * seule son empreinte est conservée en base, exactement comme les jetons du
 * portail (`applications.server.ts`).
 */

import { createHash, randomBytes } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";

export type KycRequestRow = Database["public"]["Tables"]["kyc_verification_requests"]["Row"];

/** Statut réellement opposable : calculé par le serveur, jamais déclaré par le navigateur. */
export type KycRequestStatus = "pending" | "in_progress" | "completed" | "revoked" | "expired";

export const KYC_REQUEST_MIN_HOURS = 1;
export const KYC_REQUEST_MAX_HOURS = 24 * 90;

export function hashKycToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** 48 octets aléatoires : aucune donnée personnelle, aucun identifiant prévisible. */
export function generateKycToken(): string {
  return randomBytes(48).toString("base64url");
}

export function effectiveStatus(row: {
  status: string;
  expires_at: string;
}): KycRequestStatus {
  if (row.status === "revoked") return "revoked";
  if (row.status === "completed") return "completed";
  if (new Date(row.expires_at).getTime() < Date.now()) return "expired";
  return row.status === "in_progress" ? "in_progress" : "pending";
}

/** Retrouve une demande à partir du jeton brut (jamais stocké en clair). */
export async function findKycRequestByToken(token: string): Promise<KycRequestRow | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const { data } = await supabaseAdmin
    .from("kyc_verification_requests")
    .select("*")
    .eq("token_hash", hashKycToken(token))
    .maybeSingle();
  return (data as KycRequestRow | null) ?? null;
}

/**
 * Demande réellement utilisable : ni révoquée, ni expirée, ni déjà terminée.
 * Toute opération sensible repasse par ici — le navigateur ne peut donc pas
 * réactiver un lien clos en modifiant ses paramètres.
 */
export async function requireUsableKycRequest(token: string): Promise<KycRequestRow> {
  const row = await findKycRequestByToken(token);
  if (!row) throw new Error("invalid_token");
  const status = effectiveStatus(row);
  if (status === "revoked") throw new Error("request_revoked");
  if (status === "expired") throw new Error("request_expired");
  if (status === "completed") throw new Error("request_completed");
  return row;
}

export async function touchKycRequest(id: string, patch: Record<string, unknown> = {}) {
  await supabaseAdmin
    .from("kyc_verification_requests")
    .update({ last_accessed_at: new Date().toISOString(), ...patch } as never)
    .eq("id", id);
}
