import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import { AlertCircle, FileText, ShieldCheck } from "lucide-react";
import i18n from "@/i18n";
import { Card } from "@/components/ui/card";
import { CenterLoader } from "@/components/ui/loader";
import { getApplicationByToken } from "@/lib/applications.functions";
import { formatMoney } from "@/lib/loan-math";

export const Route = createFileRoute("/secure/application/$token")({
  component: SecurePortal,
  head: () => ({
    meta: [
      { title: i18n.t("finance.portal.metaTitle") },
      { name: "description", content: i18n.t("finance.portal.metaDesc") },
      { property: "og:title", content: i18n.t("finance.portal.metaTitle") },
      { property: "og:description", content: i18n.t("finance.portal.metaDesc") },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function SecurePortal() {
  const { token } = Route.useParams();
  const { t, i18n: i18next } = useTranslation();
  const fetchFile = useServerFn(getApplicationByToken);

  const [state, setState] = useState<{ loading: boolean; error: string | null; data: Record<string, unknown> | null }>({
    loading: true, error: null, data: null,
  });

  useEffect(() => {
    let active = true;
    fetchFile({ data: { token } })
      .then((data) => { if (active) setState({ loading: false, error: null, data: data as Record<string, unknown> }); })
      .catch((error: unknown) => {
        if (active) setState({ loading: false, error: error instanceof Error ? error.message : "invalid_token", data: null });
      });
    return () => { active = false; };
  }, [token, fetchFile]);

  if (state.loading) return <CenterLoader />;

  if (state.error || !state.data) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24 text-center">
        <AlertCircle className="mx-auto h-10 w-10 text-destructive" aria-hidden />
        <h1 className="mt-4 font-serif text-2xl font-medium">{t("finance.portal.invalidTitle")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("finance.portal.invalidDesc")}</p>
      </div>
    );
  }

  const app = state.data as {
    reference: string; status: string; amount: number; duration_months: number; currency?: string;
    monthly_payment?: number; first_name?: string; last_name?: string;
    history?: Array<{ new_status: string; created_at: string }>;
  };
  const locale = i18next.resolvedLanguage ?? "fr";
  const currency = app.currency ?? "EUR";

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-10 sm:px-6 lg:px-8">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">{t("finance.portal.reference")}</p>
          <h1 className="truncate font-mono text-xl font-bold sm:text-2xl">{app.reference}</h1>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 py-1 text-xs font-medium">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          {t("finance.portal.secure")}
        </span>
      </header>

      <Card className="mt-6 p-4 sm:p-6">
        <h2 className="text-sm font-semibold">{t("finance.portal.summary")}</h2>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <Row label={t("finance.sim.amount")} value={formatMoney(app.amount, currency, locale)} />
          <Row label={t("finance.sim.duration")} value={`${app.duration_months} ${t("finance.sim.months")}`} />
          {typeof app.monthly_payment === "number" && (
            <Row label={t("finance.sim.monthly")} value={formatMoney(app.monthly_payment, currency, locale)} />
          )}
          <Row label={t("finance.portal.status")} value={t(`finance.status.${app.status}`)} />
        </dl>
      </Card>

      {app.history && app.history.length > 0 && (
        <Card className="mt-4 p-4 sm:p-6">
          <h2 className="text-sm font-semibold">{t("finance.portal.timeline")}</h2>
          <ol className="mt-3 space-y-3">
            {app.history.map((h, i) => (
              <li key={`${h.created_at}-${i}`} className="flex gap-3 text-sm">
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0">
                  <p className="font-medium">{t(`finance.status.${h.new_status}`)}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(h.created_at).toLocaleString(locale)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words text-right font-medium">{value}</dd>
    </div>
  );
}
