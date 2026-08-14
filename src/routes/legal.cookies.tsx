import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/LegalPage";
import i18n from "@/i18n";

export const Route = createFileRoute("/legal/cookies")({
  component: () => <LegalPage i18nKey="legal.cookies" updated="2026-06-22" />,
  head: () => ({ meta: [{ title: `${i18n.t("legal.cookies.title")} — BNP PARIBAS` }] }),
});
