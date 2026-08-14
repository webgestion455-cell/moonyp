import { supabase } from "@/integrations/supabase/client";

/** Journalise une action staff dans public.activity_logs (best-effort). */
export async function logActivity(
  action: string,
  opts: { entity?: string; entityId?: string; metadata?: Record<string, unknown> } = {},
) {
  try {
    const { data } = await supabase.auth.getUser();
    const user = data.user;
    if (!user) return;
    await (supabase as any).from("activity_logs").insert({
      actor_id: user.id,
      actor_email: user.email,
      action,
      entity: opts.entity ?? null,
      entity_id: opts.entityId ?? null,
      metadata: opts.metadata ?? {},
    });
  } catch {
    /* best-effort */
  }
}

export const ACTION_LABELS: Record<string, string> = {
  "staff.invited": "Invitation envoyée",
  "staff.invitation_revoked": "Invitation révoquée",
  "staff.role_updated": "Rôle modifié",
  "staff.suspended": "Membre suspendu",
  "staff.reactivated": "Membre réactivé",
  "roles.permissions_updated": "Permissions mises à jour",
  "loan.status_updated": "Statut de prêt modifié",
  "transfer.executed": "Virement exécuté",
  "transfer.rejected": "Virement rejeté",
  "payment_method.saved": "Moyen de paiement enregistré",
  "payment_method.deleted": "Moyen de paiement supprimé",
};
