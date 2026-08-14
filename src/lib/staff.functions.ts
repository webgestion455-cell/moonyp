import { createServerFn } from "@tanstack/react-start";
import {
  adminClient,
  invitationEmailHtml,
  logActivity,
  randomToken,
  requireStaff,
  sendInvitationEmail,
  sha256,
} from "./staff.server";

export const listStaff = createServerFn({ method: "POST" })
  .inputValidator((d: { accessToken: string }) => d)
  .handler(async ({ data }) => {
    const { supabase } = await requireStaff(data.accessToken, "staff.view");

    const { data: roleRows } = await supabase
      .from("user_roles")
      .select("user_id, role")
      .in("role", ["super_admin", "admin", "agent"]);

    const ids = Array.from(new Set((roleRows ?? []).map((r: { user_id: string }) => r.user_id)));
    if (ids.length === 0) return { members: [], invitations: [] };

    const { data: profiles } = await supabase
      .from("staff_profiles")
      .select("user_id, display_name, job_title, phone, active, created_at")
      .in("user_id", ids);

    const { data: authList } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
    const emailById = new Map((authList?.users ?? []).map((u) => [u.id, { email: u.email, last: u.last_sign_in_at }]));

    const members = ids.map((id) => {
      const roles = (roleRows ?? []).filter((r: { user_id: string }) => r.user_id === id).map((r: { role: string }) => r.role);
      const prof = (profiles ?? []).find((p: { user_id: string }) => p.user_id === id) as
        | { display_name?: string; job_title?: string; phone?: string; active?: boolean; created_at?: string }
        | undefined;
      const auth = emailById.get(id);
      return {
        user_id: id,
        roles,
        role: roles.includes("super_admin") ? "super_admin" : roles.includes("admin") ? "admin" : "agent",
        email: auth?.email ?? "—",
        last_sign_in_at: auth?.last ?? null,
        display_name: prof?.display_name ?? null,
        job_title: prof?.job_title ?? null,
        phone: prof?.phone ?? null,
        active: prof?.active ?? true,
        created_at: prof?.created_at ?? null,
      };
    });

    const { data: invitations } = await supabase
      .from("staff_invitations")
      .select("id, email, role, full_name, job_title, expires_at, accepted_at, revoked_at, created_at")
      .order("created_at", { ascending: false })
      .limit(50);

    return { members, invitations: invitations ?? [] };
  });

export const inviteStaff = createServerFn({ method: "POST" })
  .inputValidator(
    (d: { accessToken: string; email: string; role: "super_admin" | "admin" | "agent"; fullName?: string; jobTitle?: string; origin: string }) => d,
  )
  .handler(async ({ data }) => {
    const { supabase, user } = await requireStaff(data.accessToken, "staff.manage");
    const email = data.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Adresse e-mail invalide");

    const token = randomToken();
    const tokenHash = await sha256(token);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { error } = await supabase.from("staff_invitations").insert({
      email,
      role: data.role,
      full_name: data.fullName ?? null,
      job_title: data.jobTitle ?? null,
      token_hash: tokenHash,
      invited_by: user.id,
      expires_at: expiresAt,
    });
    if (error) throw new Error(error.message);

    const base = data.origin.replace(/\/$/, "");
    const link = `${base}/staff-invite?token=${token}`;
    const declineLink = `${base}/staff-invite?token=${token}&decline=1`;
    const mail = await sendInvitationEmail(
      email,
      invitationEmailHtml({ fullName: data.fullName, role: data.role, link, declineLink }),
    );

    await logActivity(supabase, user, "staff.invited", "staff_invitation", email, { role: data.role, emailSent: mail.sent });

    return { ok: true, emailSent: mail.sent, link: mail.sent ? null : link };
  });

export const revokeInvitation = createServerFn({ method: "POST" })
  .inputValidator((d: { accessToken: string; invitationId: string }) => d)
  .handler(async ({ data }) => {
    const { supabase, user } = await requireStaff(data.accessToken, "staff.manage");
    await supabase.from("staff_invitations").update({ revoked_at: new Date().toISOString() }).eq("id", data.invitationId);
    await logActivity(supabase, user, "staff.invitation_revoked", "staff_invitation", data.invitationId);
    return { ok: true };
  });

export const updateStaffRole = createServerFn({ method: "POST" })
  .inputValidator((d: { accessToken: string; userId: string; role: "super_admin" | "admin" | "agent" }) => d)
  .handler(async ({ data }) => {
    const { supabase, user } = await requireStaff(data.accessToken, "staff.manage");
    if (data.userId === user.id) throw new Error("Vous ne pouvez pas modifier votre propre rôle");

    await supabase.from("user_roles").delete().eq("user_id", data.userId).in("role", ["super_admin", "admin", "agent"]);
    const { error } = await supabase.from("user_roles").insert({ user_id: data.userId, role: data.role });
    if (error) throw new Error(error.message);
    await logActivity(supabase, user, "staff.role_updated", "user", data.userId, { role: data.role });
    return { ok: true };
  });

export const setStaffActive = createServerFn({ method: "POST" })
  .inputValidator((d: { accessToken: string; userId: string; active: boolean }) => d)
  .handler(async ({ data }) => {
    const { supabase, user } = await requireStaff(data.accessToken, "staff.manage");
    if (data.userId === user.id) throw new Error("Action impossible sur votre propre compte");
    await supabase
      .from("staff_profiles")
      .upsert({ user_id: data.userId, active: data.active, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (!data.active) {
      await supabase.from("user_roles").delete().eq("user_id", data.userId).in("role", ["super_admin", "admin", "agent"]);
    }
    await logActivity(supabase, user, data.active ? "staff.reactivated" : "staff.suspended", "user", data.userId);
    return { ok: true };
  });

/** Refus d'une invitation depuis l'e-mail (aucun compte n'est créé). */
export const declineStaffInvite = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    const supabase = adminClient();
    const tokenHash = await sha256(data.token);
    const { data: rows } = await supabase
      .from("staff_invitations")
      .select("id, email, accepted_at, revoked_at")
      .eq("token_hash", tokenHash)
      .limit(1);
    const invite = rows?.[0];
    if (!invite) throw new Error("Invitation introuvable");
    if (invite.accepted_at) throw new Error("Invitation déjà utilisée");
    if (!invite.revoked_at) {
      await supabase
        .from("staff_invitations")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", invite.id);
    }
    return { ok: true, email: invite.email as string };
  });

export const acceptStaffInvite = createServerFn({ method: "POST" })

  .inputValidator((d: { token: string; password: string; fullName: string }) => d)
  .handler(async ({ data }) => {
    if (data.password.length < 10) throw new Error("Le mot de passe doit contenir au moins 10 caractères");
    const supabase = adminClient();
    const tokenHash = await sha256(data.token);

    const { data: rows } = await supabase
      .from("staff_invitations")
      .select("id, email, role, job_title, expires_at, accepted_at, revoked_at")
      .eq("token_hash", tokenHash)
      .limit(1);
    const invite = rows?.[0];
    if (!invite) throw new Error("Invitation introuvable");
    if (invite.revoked_at) throw new Error("Invitation révoquée");
    if (invite.accepted_at) throw new Error("Invitation déjà utilisée");
    if (new Date(invite.expires_at).getTime() < Date.now()) throw new Error("Invitation expirée");

    const { data: existing } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
    let userId = existing?.users.find((u) => u.email?.toLowerCase() === invite.email)?.id;

    if (userId) {
      await supabase.auth.admin.updateUserById(userId, { password: data.password, email_confirm: true });
    } else {
      const { data: created, error } = await supabase.auth.admin.createUser({
        email: invite.email,
        password: data.password,
        email_confirm: true,
        user_metadata: { full_name: data.fullName },
      });
      if (error || !created.user) throw new Error(error?.message ?? "Création du compte impossible");
      userId = created.user.id;
    }

    await supabase.from("user_roles").delete().eq("user_id", userId).in("role", ["super_admin", "admin", "agent", "user"]);
    await supabase.from("user_roles").insert({ user_id: userId, role: invite.role });
    await supabase.from("staff_profiles").upsert(
      { user_id: userId, display_name: data.fullName, job_title: invite.job_title, active: true, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
    await supabase.from("staff_invitations").update({ accepted_at: new Date().toISOString() }).eq("id", invite.id);

    return { ok: true, email: invite.email };
  });
