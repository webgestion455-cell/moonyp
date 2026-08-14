import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/LegalPage";
import i18n from "@/i18n";

export const Route = createFileRoute("/legal/loan-terms")({
  component: () => <LegalPage i18nKey="legal.loanTerms" updated="2026-06-22" />,
  head: () => ({ meta: [{ title: `${i18n.t("legal.loanTerms.title")} — BNP PARIBAS` }, { name: "description", content: i18n.t("legal.loanTerms.subtitle") }] }),
});
