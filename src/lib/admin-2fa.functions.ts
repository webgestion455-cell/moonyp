import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

// 2FA multi-admin — le code est envoyé à l'adresse email du staff connecté,
// plus de restriction à un email codé en dur. L'accès est réservé aux
// utilisateurs ayant un rôle staff (super_admin | admin | agent).

function getAdminClient() {
  const supabaseUrl =
    process.env.SUPABASE_URL ||
    import.meta.env.VITE_SUPABASE_URL;

  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) throw new Error("SUPABASE_URL manquant");
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY manquant");

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

async function hash(code: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(code + "|" + salt);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function assertStaff(supabase: ReturnType<typeof getAdminClient>, accessToken: string) {
  const { data: userData, error: userErr } = await supabase.auth.getUser(accessToken);
  if (userErr || !userData.user) throw new Error("Non authentifié");
  const user = userData.user;
  if (!user.email) throw new Error("Compte sans email");

  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .in("role", ["super_admin", "admin", "agent"]);
  if (!roles || roles.length === 0) throw new Error("Accès réservé à l'équipe");

  return user;
}

export const requestAdminCode = createServerFn({ method: "POST" })
  .inputValidator((d: { accessToken: string }) => d)
  .handler(async ({ data }) => {
    const supabase = getAdminClient();
    const user = await assertStaff(supabase, data.accessToken);

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const codeHash = await hash(code, user.email!);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await supabase.from("admin_verification_codes").insert({
      user_id: user.id,
      code_hash: codeHash,
      expires_at: expiresAt,
    });

    const resendKey = process.env.RESEND_API_KEY_MAIL;
    if (resendKey) {
      try {
        const resend = new Resend(resendKey);
        await resend.emails.send({
          from: "BNP PARIBAS Admin <no-reply@zenvoriax.com>",
          to: user.email!,
          subject: `Code admin BNP PARIBAS : ${code}`,
          html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;background:#fafaf7;border-radius:12px"><h1 style="color:#0a0a0a;margin:0 0 8px">Connexion administrateur</h1><p style="color:#55575d;font-size:14px">Voici votre code de vérification à usage unique. Il expire dans 10 minutes.</p><div style="font-size:36px;font-weight:bold;letter-spacing:8px;text-align:center;background:#fff;border:1px solid #e5e5e0;border-radius:12px;padding:20px;margin:20px 0">${code}</div><p style="color:#999;font-size:12px">Si vous n'êtes pas à l'origine de cette demande, ignorez cet email et changez immédiatement votre mot de passe.</p></div>`,
        });
        return { sent: true, channel: "email" as const, email: user.email! };
      } catch (e) {
        console.error("Resend failed:", e);
      }
    }

    console.log(`[ADMIN 2FA] Code pour ${user.email} : ${code}`);
    return { sent: true, channel: "console" as const, devCode: code, email: user.email! };
  });

export const verifyAdminCode = createServerFn({ method: "POST" })
  .inputValidator((d: { accessToken: string; code: string }) => d)
  .handler(async ({ data }) => {
    const supabase = getAdminClient();
    const user = await assertStaff(supabase, data.accessToken);

    const codeHash = await hash(data.code.trim(), user.email!);
    const { data: rows } = await supabase
      .from("admin_verification_codes")
      .select("id, expires_at, used")
      .eq("user_id", user.id)
      .eq("code_hash", codeHash)
      .eq("used", false)
      .order("created_at", { ascending: false })
      .limit(1);

    const row = rows?.[0];
    if (!row) throw new Error("Code invalide");
    if (new Date(row.expires_at).getTime() < Date.now()) throw new Error("Code expiré");

    await supabase.from("admin_verification_codes").update({ used: true }).eq("id", row.id);
    return { verified: true };
  });
