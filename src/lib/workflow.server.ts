/**
 * Exécution serveur du workflow métier : transitions contrôlées, historique,
 * audit, notifications back-office et emails transactionnels dans la langue
 * du client. Aucun composant ne doit court-circuiter ce module.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { canTransition, type WorkflowContext } from "@/lib/application-workflow";
import type { ApplicationStatus } from "@/lib/application-status";
import { logEvent, issuePortalToken } from "@/lib/applications.server";
import {
  renderEmailHtml,
  renderEmailText,
  type EmailDetail,
  type EmailTemplateInput,
} from "@/lib/email-render.server";

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

/**
 * Destination de l'espace sécurisé selon le type d'email.
 *
 * `hash` cible la SECTION exacte concernée dans l'espace client (ancre posée
 * sur la carte correspondante) : le client atterrit directement sur la pièce
 * manquante, la demande d'information ou la garantie, sans avoir à parcourir
 * la page.
 */
const CTA_BY_TEMPLATE: Record<
  string,
  { path: "" | "/contract" | "/payment"; label: string; hash?: string }
> = {
  applicationReceived: { path: "", label: "portal" },
  documentsMissing: { path: "", label: "documents", hash: "documents" },
  infoRequested: { path: "", label: "documents", hash: "info-requests" },
  approved: { path: "", label: "portal", hash: "offer" },
  rejected: { path: "", label: "portal" },
  offerAvailable: { path: "", label: "portal", hash: "offer" },
  contractSent: { path: "/contract", label: "contract" },
  signatureCode: { path: "/contract", label: "contract" },
  contractSigned: { path: "/contract", label: "contract" },
  guaranteeSent: { path: "", label: "guarantee", hash: "guarantee" },
  guaranteePayNow: { path: "/payment", label: "payment" },
  guaranteePayLater: { path: "", label: "portal", hash: "guarantee" },
  guaranteeDeclined: { path: "", label: "portal", hash: "guarantee" },
  guaranteePaymentValidated: { path: "", label: "portal", hash: "guarantee" },
  insurancePending: { path: "/payment", label: "insurance" },
  insuranceValidated: { path: "", label: "portal", hash: "insurance" },
  disbursed: { path: "", label: "portal", hash: "disbursement" },
  repaymentReminder: { path: "/payment", label: "payment" },
  installmentReminder: { path: "/payment", label: "payment" },
  guaranteeReminder: { path: "/payment", label: "payment" },
};

function siteUrl(): string {
  return (process.env["PUBLIC_SITE_URL"] ?? "https://moonyp.webgestion95.workers.dev").replace(/\/$/, "");
}

/**
 * Met un email en file d'attente, rédigé dans la langue du demandeur et rendu
 * en HTML responsive de niveau bancaire. Chaque email embarque un bouton vers
 * l'espace sécurisé du client (lien personnel révocable).
 */
export async function queueEmail(options: {
  applicationId: string;
  to: string;
  locale: string | null | undefined;
  template: string;
  vars?: Record<string, string>;
}): Promise<void> {
  const vars = options.vars ?? {};
  const locale = (options.locale ?? "en").slice(0, 2).toLowerCase();
  const template = options.template;
  const T = (key: string, v: Record<string, string> = vars) => tServer(locale, key, v);

  // Lien vers l'espace sécurisé : réutilise celui fourni, sinon en émet un.
  const cta = CTA_BY_TEMPLATE[template] ?? { path: "" as const, label: "portal" };
  let ctaUrl = vars.link ?? "";
  if (!ctaUrl) {
    try {
      const token = await issuePortalToken(options.applicationId, "email");
      ctaUrl = `${siteUrl()}/${locale}/secure/application/${token}${cta.path}${cta.hash ? `#${cta.hash}` : ""}`;
    } catch (e) {
      console.error("[queueEmail] portal token failed", e);
    }
  }

  // Récapitulatif du dossier, pour un email réellement informatif.
  const { data: app } = await supabaseAdmin
    .from("loan_applications")
    .select("reference, amount, duration_months, monthly_payment, status")
    .eq("id", options.applicationId)
    .maybeSingle();

  const details: EmailDetail[] = [];
  const push = (label: string, value: string | null | undefined) => {
    if (value) details.push({ label, value });
  };
  push(T("emails.common.reference"), app?.reference ?? vars.reference);
  push(T("emails.common.amount"), app?.amount != null ? `${Number(app.amount).toLocaleString(locale)} EUR` : null);
  push(
    T("emails.common.duration"),
    app?.duration_months ? `${app.duration_months} ${T("emails.common.months")}` : null,
  );
  push(
    T("emails.common.monthly"),
    app?.monthly_payment != null ? `${Number(app.monthly_payment).toLocaleString(locale)} EUR` : null,
  );
  push(T("emails.common.status"), app?.status ? T(`finance.status.${app.status}`) : null);
  if (vars.amount) push(T("emails.common.feeAmount"), vars.amount);
  if (vars.date) push(T("emails.common.scheduledDate"), vars.date);

  const subject = T(`emails.${template}.subject`);
  const intro = T(`emails.${template}.body`);
  const extra = tServer(locale, `emails.${template}.details`, vars);
  const paragraphs = extra && extra !== `emails.${template}.details` ? [extra] : [];

  const spec: EmailTemplateInput = {
    title: subject,
    intro,
    paragraphs,
    detailsTitle: T("emails.common.summary"),
    details,
    ctaLabel: T(`emails.cta.${cta.label}`),
    ctaUrl,
    ...(vars.code ? { code: vars.code, noticeTitle: T("emails.common.codeTitle") } : {}),
    ...(!vars.code && vars.reason ? { noticeTitle: T("emails.common.reasonTitle"), noticeBody: vars.reason } : {}),
    securityNotice: T("emails.common.secureNotice"),
    helpText: T("emails.common.needHelp"),
    legalText: T("emails.common.footerLegal"),
    autoText: T("emails.common.autoMessage"),
    tagline: T("emails.common.tagline"),
    preheader: intro.slice(0, 140),
  };

  const { error: insertError } = await supabaseAdmin
  .from("transactional_emails")
  .insert({
    application_id: options.applicationId,
    to_email: options.to,
    locale,
    template,
    subject,
    body: renderEmailHtml(spec),
    payload: { ...vars, text: renderEmailText(spec), cta_url: ctaUrl } as never,
  } as never);

if (insertError) {
  console.error("[queueEmail] transactional_emails insert failed:", {
    applicationId: options.applicationId,
    to: options.to,
    template,
    error: insertError,
  });

  throw new Error(
    `Impossible de mettre l'email en file d'attente: ${insertError.message}`,
  );
}
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
