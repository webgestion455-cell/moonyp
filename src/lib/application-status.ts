import i18n from "@/i18n";
import type { Database } from "@/integrations/supabase/types";

export type ApplicationStatus = Database["public"]["Enums"]["application_status"];

/** Canonical workflow order — drives timelines and progress bars. */
export const APPLICATION_STATUS_ORDER: ApplicationStatus[] = [
  "draft",
  "received",
  "verification",
  "documents_missing",
  "analysis",
  "info_requested",
  "approved",
  "offer_available",
  "contract_sent",
  "signature_pending",
  "contract_signed",
  "guarantee_sent",
  "guarantee_signed",
  "insurance_pending",
  "insurance_validated",
  "disbursement_preparing",
  "disbursed",
  "repaying",
  "late",
  "repaid",
  "rejected",
  "cancelled",
];

type Variant = "default" | "info" | "success" | "warning" | "destructive" | "muted";

export const APPLICATION_STATUS_VARIANT: Record<ApplicationStatus, Variant> = {
  draft: "muted",
  received: "info",
  verification: "info",
  documents_missing: "warning",
  analysis: "warning",
  info_requested: "warning",
  approved: "success",
  rejected: "destructive",
  offer_available: "success",
  contract_sent: "info",
  signature_pending: "warning",
  contract_signed: "success",
  guarantee_sent: "info",
  guarantee_signed: "success",
  insurance_pending: "warning",
  insurance_validated: "success",
  disbursement_preparing: "info",
  disbursed: "success",
  repaying: "info",
  late: "destructive",
  repaid: "success",
  cancelled: "muted",
};

/** Statuses shown on the public client timeline, in order. */
export const CLIENT_TIMELINE: ApplicationStatus[] = [
  "received",
  "analysis",
  "approved",
  "contract_sent",
  "contract_signed",
  "disbursed",
  "repaying",
];

export function statusLabel(status: ApplicationStatus | null | undefined): string {
  if (!status) return i18n.t("finance.status.unknown", { defaultValue: "—" });
  return i18n.t(`finance.status.${status}`, { defaultValue: status.replace(/_/g, " ") });
}


export function isTerminal(status: ApplicationStatus): boolean {
  return status === "rejected" || status === "cancelled" || status === "repaid";
}
