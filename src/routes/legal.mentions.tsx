import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/LegalPage";
import i18n from "@/i18n";

export const Route = createFileRoute("/legal/mentions")({
  component: () => <LegalPage i18nKey="legal.mentions" updated="2026-06-22" />,
  head: () => ({ meta: [{ title: `${i18n.t("legal.mentions.title")} — BNP PARIBAS` }] }),
});
