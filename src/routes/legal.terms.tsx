import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/LegalPage";
import i18n from "@/i18n";

export const Route = createFileRoute("/legal/terms")({
  component: () => <LegalPage i18nKey="legal.terms" updated="2026-06-22" />,
  head: () => ({ meta: [{ title: `${i18n.t("legal.terms.title")} — BNP PARIBAS` }, { name: "description", content: i18n.t("legal.terms.subtitle") }] }),
});
