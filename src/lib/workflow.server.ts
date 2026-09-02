/**
 * Exécution serveur du workflow métier : transitions contrôlées, historique,
 * audit, notifications back-office et emails transactionnels dans la langue
 * du client. Aucun composant ne doit court-circuiter ce module.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { canTransition, type WorkflowContext } from "@/lib/application-workflow";
import type { ApplicationStatus } from "@/lib/application-status";
import { logEvent } from "@/lib/applications.server";

import bg from "@/i18n/locales/bg.json";
import de from "@/i18n/locales/de.json";
import el from "@/i18n/locales/el.json";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import fi from "@/i18n/locales/fi.json";
import fr from "@/i18n/locales/fr.json";
import hr from "@/i18n/locales/hr.json";
import hu from "@/i18n/locales/hu.json";
import it from "@/i18n/locales/it.json";
import nl from "@/i18n/locales/nl.json";
import pl from "@/i18n/locales/pl.json";
import ro from "@/i18n/locales/ro.json";
import sk from "@/i18n/locales/sk.json";
import sl from "@/i18n/locales/sl.json";

const BUNDLES: Record<string, unknown> = { bg, de, el, en, es, fi, fr, hr, hu, it, nl, pl, ro, sk, sl };

function lookup(bundle: unknown, path: string): string | null {
  const value = path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, bundle);
  return typeof value === "string" && value.trim() ? value : null;
}

/** Traduction serveur : langue du client, repli anglais puis français. */
export function tServer(locale: string | null | undefined, key: string, vars: Record<string, string> = {}): string {
  const lang = (locale ?? "en").slice(0, 2).toLowerCase();
  const raw = lookup(BUNDLES[lang], key) ?? lookup(BUNDLES.en, key) ?? lookup(BUNDLES.fr, key) ?? key;
  return raw.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => vars[name] ?? "");
}

/** Met un email en file d'attente, rédigé dans la langue du demandeur. */
export async function queueEmail(options: {
  applicationId: string;
  to: string;
  locale: string | null | undefined;
  template: string;
  vars?: Record<string, string>;
}): Promise<void> {
  const vars = options.vars ?? {};
  const locale = (options.locale ?? "en").slice(0, 2).toLowerCase();
  await supabaseAdmin.from("transactional_emails").insert({
    application_id: options.applicationId,
    to_email: options.to,
    locale,
    template: options.template,
    subject: tServer(locale, `emails.${options.template}.subject`, vars),
    body: tServer(locale, `emails.${options.template}.body`, vars),
    payload: vars as never,
  } as never);
}

/** Notifie tous les administrateurs (une notification par compte staff). */
export async function notifyAdmins(input: {
  title: string;
  message: string;
  link?: string | null;
  category?: string;
}): Promise<void> {
  const { data: admins } = await supabaseAdmin.from("user_roles").select("user_id").eq("role", "admin");
  const rows = (admins ?? []).map((a) => ({
    user_id: a.user_id,
    title: input.title,
    message: input.message,
    link: input.link ?? null,
    category: input.category ?? "application",
  }));
  if (rows.length > 0) await supabaseAdmin.from("notifications").insert(rows as never);
}

export interface ApplicationSnapshot {
  id: string;
  reference: string;
  status: ApplicationStatus;
  language: string | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  amount: number | null;
  kyc_status: string | null;
  insurance_opted: boolean | null;
  bank_iban: string | null;
  compliance_flags: unknown;
}

/** Charge le dossier + agrégats nécessaires à l'évaluation des gardes. */
export async function loadWorkflowContext(
  applicationId: string,
): Promise<{ application: ApplicationSnapshot; context: WorkflowContext } | null> {
  const { data: application } = await supabaseAdmin
    .from("loan_applications")
    .select(
      "id, reference, status, language, email, first_name, last_name, amount, kyc_status, insurance_opted, bank_iban, compliance_flags",
    )
    .eq("id", applicationId)
    .maybeSingle();
  if (!application) return null;

  const [{ data: documents }, { data: requests }, { data: requiredTypes }] = await Promise.all([
    supabaseAdmin.from("application_documents").select("document_type_slug, status").eq("application_id", applicationId),
    supabaseAdmin
      .from("application_info_requests")
      .select("id")
      .eq("application_id", applicationId)
      .eq("status", "open"),
    supabaseAdmin.from("document_types").select("slug").eq("active", true).eq("required", true),
  ]);

  const approved = new Set(
    (documents ?? []).filter((d) => d.status === "approved").map((d) => d.document_type_slug),
  );
  const pendingRequiredDocuments = (requiredTypes ?? []).filter((t) => !approved.has(t.slug)).length;

  const flags = Array.isArray(application.compliance_flags)
    ? (application.compliance_flags as Array<{ severity?: string }>)
    : [];

  return {
    application: application as unknown as ApplicationSnapshot,
    context: {
      kycStatus: application.kyc_status,
      pendingRequiredDocuments,
      openInfoRequests: (requests ?? []).length,
      blockingComplianceFlags: flags.filter((f) => f?.severity === "error").length,
      hasPayoutDetails: Boolean(application.bank_iban),
      insuranceOpted: Boolean(application.insurance_opted),
    },
  };
}

export interface TransitionResult {
  ok: boolean;
  reason?: string;
  status?: ApplicationStatus;
}

/**
 * Applique une transition : garde métier → mise à jour → historique (via le
 * trigger append-only) → évènement d'audit → notification → email client.
 */
export async function applyTransition(input: {
  applicationId: string;
  to: ApplicationStatus;
  actorId?: string | null;
  actor?: string;
  reason?: string | null;
  note?: string | null;
}): Promise<TransitionResult> {
  const loaded = await loadWorkflowContext(input.applicationId);
  if (!loaded) return { ok: false, reason: "workflow.error.notFound" };

  const { application, context } = loaded;
  const from = application.status;
  const check = canTransition(from, input.to, context);
  if (!check.ok) return { ok: false, reason: check.reason, status: from };

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status: input.to,
    admin_notes: input.note ?? input.reason ?? null,
  };
  if (input.to === "rejected") patch.rejection_reason = input.reason ?? input.note ?? null;
  if (["approved", "rejected"].includes(input.to)) patch.decided_at = now;

  const { error } = await supabaseAdmin.from("loan_applications").update(patch as never).eq("id", input.applicationId);
  if (error) return { ok: false, reason: error.message, status: from };

  // Historique explicite (motif conservé) — la table est append-only.
  await supabaseAdmin.from("application_status_history").insert({
    application_id: input.applicationId,
    old_status: from,
    new_status: input.to,
    actor: input.actor ?? "staff",
    changed_by: input.actorId ?? null,
    note: input.note ?? null,
    reason: input.reason ?? null,
  } as never);

  await logEvent(input.applicationId, "status_changed", {
    actor: input.actor ?? "staff",
    actorId: input.actorId ?? null,
    description: `${from} → ${input.to}`,
    metadata: { from, to: input.to, reason: input.reason ?? null },
  });

  await notifyAdmins({
    title: `${application.reference}`,
    message: `${from} → ${input.to}`,
    link: `/admin/applications/${application.id}`,
    category: "application",
  });

  const template = EMAIL_TEMPLATE_BY_STATUS[input.to];
  if (template && application.email) {
    await queueEmail({
      applicationId: application.id,
      to: application.email,
      locale: application.language,
      template,
      vars: {
        reference: application.reference,
        firstName: application.first_name ?? "",
        reason: input.reason ?? "",
      },
    });
  }

  return { ok: true, status: input.to };
}

/** Un statut peut déclencher un email transactionnel dédié. */
export const EMAIL_TEMPLATE_BY_STATUS: Partial<Record<ApplicationStatus, string>> = {
  received: "applicationReceived",
  documents_missing: "documentsMissing",
  info_requested: "infoRequested",
  approved: "approved",
  rejected: "rejected",
  offer_available: "offerAvailable",
  contract_sent: "contractSent",
  disbursed: "disbursed",
};
