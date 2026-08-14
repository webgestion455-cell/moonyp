import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/LegalPage";
import i18n from "@/i18n";

export const Route = createFileRoute("/legal/financial-privacy")({
  component: () => <LegalPage i18nKey="legal.finPriv" updated="2026-06-22" />,
  head: () => ({ meta: [{ title: `${i18n.t("legal.finPriv.title")} — BNP PARIBAS` }] }),
});
