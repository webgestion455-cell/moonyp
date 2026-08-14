import { createHash, randomBytes } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";

export type ApplicationStatus = Database["public"]["Enums"]["application_status"];
export type ApplicationRow = Database["public"]["Tables"]["loan_applications"]["Row"];

export const PORTAL_TOKEN_TTL_DAYS = 120;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateToken(): string {
  return randomBytes(48).toString("base64url");
}

export function generateOtp(): string {
  // 6 digits, uniformly drawn from a cryptographic source.
  return String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

/** Issues a fresh, revocable portal token for an application. */
export async function issuePortalToken(applicationId: string, purpose = "portal"): Promise<string> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + PORTAL_TOKEN_TTL_DAYS * 24 * 3600 * 1000).toISOString();
  const { error } = await supabaseAdmin.from("application_access_tokens").insert({
    application_id: applicationId,
    token_hash: hashToken(token),
    purpose,
    expires_at: expiresAt,
  });
  if (error) throw new Error(error.message);
  return token;
}

/** Resolves a raw portal token to its application id, or null when invalid. */
export async function resolveToken(token: string): Promise<string | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const { data } = await supabaseAdmin
    .from("application_access_tokens")
    .select("id, application_id, revoked, expires_at, use_count")
    .eq("token_hash", hashToken(token))
    .maybeSingle();

  if (!data || data.revoked) return null;
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return null;

  await supabaseAdmin
    .from("application_access_tokens")
    .update({ last_used_at: new Date().toISOString(), use_count: (data.use_count ?? 0) + 1 })
    .eq("id", data.id);

  return data.application_id;
}

export async function logEvent(
  applicationId: string,
  eventType: string,
  options: {
    actor?: string;
    actorId?: string | null;
    description?: string;
    metadata?: Record<string, unknown>;
    ip?: string | null;
  } = {},
): Promise<void> {
  await supabaseAdmin.from("application_events").insert({
    application_id: applicationId,
    event_type: eventType,
    actor: options.actor ?? "applicant",
    actor_id: options.actorId ?? null,
    description: options.description ?? null,
    metadata: (options.metadata ?? null) as never,
    ip: options.ip ?? null,
  });
}

/** Fields the applicant is allowed to see through the secure link. */
export const PORTAL_FIELDS =
  "id, reference, status, language, product_id, first_name, last_name, city, country, email, " +
  "amount, duration_months, purpose, insurance_opted, submitted_at, decided_at, created_at, updated_at, rejection_reason";

/** Masks an IBAN for display: FR76 **** **** 1234 */
export function maskIban(iban: string | null | undefined): string {
  if (!iban) return "";
  const clean = iban.replace(/\s+/g, "");
  if (clean.length < 8) return "••••";
  return `${clean.slice(0, 4)} •••• •••• ${clean.slice(-4)}`;
}

const RATE_BUCKET = new Map<string, { count: number; resetAt: number }>();

/** Small in-process guard against abusive bursts on public endpoints. */
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = RATE_BUCKET.get(key);
  if (!entry || entry.resetAt < now) {
    RATE_BUCKET.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= max) return false;
  entry.count += 1;
  return true;
}
