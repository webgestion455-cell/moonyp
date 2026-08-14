// Logique serveur RBAC / équipe — jamais importé côté client
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type StaffRoleValue = "super_admin" | "admin" | "agent";

export function adminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Configuration serveur Supabase manquante");
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Vérifie le jeton et exige une permission (les super_admin passent toujours). */
export async function requireStaff(accessToken: string, permission?: string) {
  const supabase = adminClient();
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) throw new Error("Non authentifié");
  const user = data.user;

  const { data: roleRows } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  const isSuper = roles.includes("super_admin");
  const isStaff = isSuper || roles.includes("admin") || roles.includes("agent");
  if (!isStaff) throw new Error("Accès refusé");

  if (permission && !isSuper) {
    const { data: perms } = await supabase
      .from("role_permissions")
      .select("permission_key")
      .in("role", roles)
      .eq("permission_key", permission);
    if (!perms || perms.length === 0) throw new Error("Permission insuffisante");
  }
  return { supabase, user, roles, isSuper };
}

export async function logActivity(
  supabase: SupabaseClient,
  actor: { id: string; email?: string | null },
  action: string,
  entity?: string,
  entityId?: string,
  metadata: Record<string, unknown> = {},
) {
  await supabase.from("activity_logs").insert({
    actor_id: actor.id,
    actor_email: actor.email ?? null,
    action,
    entity: entity ?? null,
    entity_id: entityId ?? null,
    metadata,
  });
}

export async function sha256(value: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function invitationEmailHtml(params: {
  fullName?: string | null;
  role: string;
  link: string;
  declineLink?: string;
}) {
  const roleLabel =
    params.role === "super_admin" ? "Super administrateur" : params.role === "admin" ? "Administrateur" : "Agent / Conseiller";
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;background:#ffffff;border:1px solid #e6e8e6;border-radius:14px;overflow:hidden">
    <div style="background:#00915A;padding:20px 24px;color:#fff">
      <div style="font-size:18px;font-weight:700;letter-spacing:.5px">BNP PARIBAS</div>
      <div style="font-size:12px;opacity:.85">Espace d'administration sécurisé</div>
    </div>
    <div style="padding:24px">
      <h1 style="font-size:19px;margin:0 0 10px;color:#0a0a0a">Bonjour ${params.fullName ?? ""},</h1>
      <p style="font-size:14px;color:#55575d;line-height:1.6;margin:0 0 16px">
        Vous avez été invité(e) à rejoindre l'équipe BNP PARIBAS en tant que <strong>${roleLabel}</strong>.
        Cliquez sur le bouton ci-dessous pour créer votre mot de passe et activer votre accès.
      </p>
      <p style="text-align:center;margin:26px 0">
        <a href="${params.link}" style="background:#00915A;color:#fff;text-decoration:none;padding:13px 26px;border-radius:10px;font-weight:600;font-size:14px;display:inline-block">Activer mon accès</a>
        ${
          params.declineLink
            ? `<a href="${params.declineLink}" style="margin-left:10px;background:#ffffff;color:#55575d;border:1px solid #d9dbd9;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;font-size:14px;display:inline-block">Refuser l'invitation</a>`
            : ""
        }
      </p>
      <p style="font-size:12px;color:#8a8d92;line-height:1.6">
        Ce lien est personnel et expire dans 7 jours. Si vous n'êtes pas concerné(e) par cette invitation, cliquez sur « Refuser l'invitation » ou ignorez cet e-mail.
      </p>
    </div>

    <div style="background:#f7f8f7;padding:14px 24px;font-size:11px;color:#8a8d92">
      © 2000-${new Date().getFullYear()} BNP PARIBAS — Tous droits réservés.
    </div>
  </div>`;
}

export async function sendInvitationEmail(to: string, html: string) {
  const key = process.env.RESEND_API_KEY_MAIL || process.env.RESEND_API_KEY;
  if (!key) return { sent: false as const, reason: "no_provider" };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      from: "BNP PARIBAS <no-reply@zenvoriax.com>",
      to: [to],
      subject: "Votre accès à l'espace d'administration BNP PARIBAS",
      html,
    }),
  });
  if (!res.ok) return { sent: false as const, reason: await res.text() };
  return { sent: true as const };
}
