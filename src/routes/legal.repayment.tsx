import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/LegalPage";
import i18n from "@/i18n";

export const Route = createFileRoute("/legal/repayment")({
  component: () => <LegalPage i18nKey="legal.repayment" updated="2026-06-22" />,
  head: () => ({ meta: [{ title: `${i18n.t("legal.repayment.title")} — BNP PARIBAS` }] }),
});
