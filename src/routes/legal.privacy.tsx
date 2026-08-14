import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/LegalPage";
import i18n from "@/i18n";

export const Route = createFileRoute("/legal/privacy")({
  component: () => <LegalPage i18nKey="legal.privacy" updated="2026-06-22" />,
  head: () => ({ meta: [{ title: `${i18n.t("legal.privacy.title")} — BNP PARIBAS` }, { name: "description", content: i18n.t("legal.privacy.subtitle") }] }),
});
