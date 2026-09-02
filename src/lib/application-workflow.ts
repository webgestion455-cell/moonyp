/**
 * Moteur de transition centralisé des dossiers de financement.
 *
 * Toute règle métier de passage d'un statut à un autre vit ICI — jamais dans
 * un composant, jamais dans une route. Le back-office et les fonctions
 * serveur consomment les mêmes règles, ce qui garantit qu'une transition
 * refusée côté serveur est également grisée côté interface.
 *
 * L'architecture est extensible : ajouter une étape = ajouter une entrée dans
 * `TRANSITIONS` (et éventuellement un garde dans `GUARDS`).
 */
import type { ApplicationStatus } from "@/lib/application-status";

/** Contexte métier évalué au moment de la transition. */
export interface WorkflowContext {
  /** Statut agrégé KYC du dossier : pending | verifying | passed | failed */
  kycStatus?: string | null;
  /** Nombre de pièces obligatoires encore non validées. */
  pendingRequiredDocuments?: number;
  /** Nombre de demandes d'informations encore ouvertes. */
  openInfoRequests?: number;
  /** Le dossier porte-t-il des signaux de conformité bloquants ? */
  blockingComplianceFlags?: number;
  /** Coordonnées de versement présentes et auditées. */
  hasPayoutDetails?: boolean;
  /** Assurance souscrite par le client. */
  insuranceOpted?: boolean;
}

export type Guard = (ctx: WorkflowContext) => string | null;

/** Transitions autorisées : statut courant → statuts atteignables. */
export const TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  draft: ["received", "cancelled"],
  received: ["verification", "analysis", "documents_missing", "rejected", "cancelled"],
  verification: ["documents_missing", "info_requested", "analysis", "rejected", "cancelled"],
  documents_missing: ["verification", "analysis", "rejected", "cancelled"],
  analysis: ["info_requested", "documents_missing", "approved", "rejected", "cancelled"],
  info_requested: ["analysis", "verification", "rejected", "cancelled"],
  approved: ["offer_available", "cancelled"],
  offer_available: ["contract_sent", "cancelled", "rejected"],
  contract_sent: ["signature_pending", "offer_available", "cancelled"],
  signature_pending: ["contract_signed", "contract_sent", "cancelled"],
  contract_signed: ["guarantee_sent", "insurance_pending", "disbursement_preparing", "cancelled"],
  guarantee_sent: ["guarantee_signed", "cancelled"],
  guarantee_signed: ["insurance_pending", "disbursement_preparing", "cancelled"],
  insurance_pending: ["insurance_validated", "cancelled"],
  insurance_validated: ["disbursement_preparing", "cancelled"],
  disbursement_preparing: ["disbursed", "cancelled"],
  disbursed: ["repaying", "late"],
  repaying: ["late", "repaid"],
  late: ["repaying", "repaid"],
  repaid: [],
  rejected: [],
  cancelled: [],
};

/** Conditions obligatoires à satisfaire pour ENTRER dans un statut. */
const GUARDS: Partial<Record<ApplicationStatus, Guard>> = {
  approved: (ctx) => {
    if (ctx.kycStatus !== "passed") return "workflow.guard.kycNotPassed";
    if ((ctx.pendingRequiredDocuments ?? 0) > 0) return "workflow.guard.documentsPending";
    if ((ctx.openInfoRequests ?? 0) > 0) return "workflow.guard.infoRequestsOpen";
    return null;
  },
  offer_available: (ctx) => (ctx.kycStatus === "passed" ? null : "workflow.guard.kycNotPassed"),
  insurance_validated: (ctx) => (ctx.insuranceOpted ? null : "workflow.guard.noInsurance"),
  disbursement_preparing: (ctx) => {
    if (!ctx.hasPayoutDetails) return "workflow.guard.missingPayout";
    if ((ctx.blockingComplianceFlags ?? 0) > 0) return "workflow.guard.complianceBlocking";
    return null;
  },
  disbursed: (ctx) => {
    if (!ctx.hasPayoutDetails) return "workflow.guard.missingPayout";
    if (ctx.kycStatus !== "passed") return "workflow.guard.kycNotPassed";
    if ((ctx.openInfoRequests ?? 0) > 0) return "workflow.guard.infoRequestsOpen";
    return null;
  },
};

export interface TransitionCheck {
  ok: boolean;
  /** Clé i18n expliquant le refus (`workflow.error.*` / `workflow.guard.*`). */
  reason?: string;
}

/** Une transition est-elle structurellement possible (hors conditions) ? */
export function isAllowedTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

/** Vérification complète : graphe + conditions métier. */
export function canTransition(
  from: ApplicationStatus,
  to: ApplicationStatus,
  ctx: WorkflowContext = {},
): TransitionCheck {
  if (from === to) return { ok: false, reason: "workflow.error.sameStatus" };
  if (!isAllowedTransition(from, to)) return { ok: false, reason: "workflow.error.notAllowed" };
  const guard = GUARDS[to]?.(ctx);
  return guard ? { ok: false, reason: guard } : { ok: true };
}

/** Statuts proposables depuis le statut courant, avec leur éligibilité. */
export function nextStatuses(
  from: ApplicationStatus,
  ctx: WorkflowContext = {},
): Array<{ status: ApplicationStatus; check: TransitionCheck }> {
  return (TRANSITIONS[from] ?? []).map((status) => ({ status, check: canTransition(from, status, ctx) }));
}

/** Statuts qui déclenchent une décision formelle (confirmation obligatoire). */
export const DECISION_STATUSES: ApplicationStatus[] = ["approved", "rejected", "cancelled"];

/** Statuts pour lesquels un motif est obligatoire. */
export const REASON_REQUIRED: ApplicationStatus[] = ["rejected", "cancelled", "info_requested", "documents_missing"];

export const INFO_REQUEST_KINDS = [
  "missing_document",
  "replace_document",
  "information",
  "justification",
] as const;
export type InfoRequestKind = (typeof INFO_REQUEST_KINDS)[number];
