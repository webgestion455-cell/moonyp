import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Copy, Info, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import i18n from "@/i18n";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CenterLoader } from "@/components/ui/loader";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { MethodBrands } from "@/components/payments/PaymentBrands";
import { createPaymentIntent, getPaymentOptions } from "@/lib/payments.functions";
import { formatMoney } from "@/lib/loan-math";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";

export const Route = createFileRoute("/$lang/secure/application/$token/payment")({
  component: PaymentPage,
  head: () => ({
    meta: [
      { title: i18n.t("finance.payment.metaTitle") },
      { name: "description", content: i18n.t("finance.payment.metaDesc") },
      { property: "og:title", content: i18n.t("finance.payment.metaTitle") },
      { property: "og:description", content: i18n.t("finance.payment.metaDesc") },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

type Options = Awaited<ReturnType<typeof getPaymentOptions>>;
type Intent = Awaited<ReturnType<typeof createPaymentIntent>>;

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 py-1.5 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-medium">{value}</span>
    </div>
  );
}

function PaymentPage() {
  const { lang, token } = Route.useParams();
  const { t, i18n: i18next } = useTranslation();
  const load = useServerFn(getPaymentOptions);
  const create = useServerFn(createPaymentIntent);

  const [data, setData] = useState<Options | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [purpose, setPurpose] = useState<string>("guarantee_fee");
  const [intent, setIntent] = useState<Intent | null>(null);

  /**
   * `silent` : cadence de fond (5 s). On met à jour les montants et l'état des
   * échéances, mais jamais le moyen de paiement ni l'objet déjà choisis par le
   * client : sa sélection en cours ne doit pas être écrasée.
   */
  const refresh = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const res = await load({ data: { token } });
        setData(res);
        if (!silent) {
          const firstDue = res.dues.find((d) => d.status !== "paid");
          if (firstDue) setPurpose(firstDue.purpose);
          if (res.methods[0]) setSelected(res.methods[0].id);
        }
      } catch {
        if (!silent) setData(null);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [load, token],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Les échéances se mettent à jour seules dès que le back-office agit.
  // Suspendu pendant un paiement en cours ou l'affichage des instructions.
  useAutoRefresh(() => refresh(true), { enabled: !busy && !intent });


  const due = data?.dues.find((d) => d.purpose === purpose) ?? null;

  async function pay() {
    if (!selected || busy || !due) return;
    setBusy(true);
    try {
      const res = await create({
        data: {
          token,
          method_id: selected,
          purpose: purpose as "guarantee_fee",
          amount: due.amount,
          return_url: window.location.href,
        },
      });
      setIntent(res);
      if (res.redirectUrl) {
        toast.success(t("finance.payment.redirecting"));
        window.location.assign(res.redirectUrl);
        return;
      }
      toast.success(t("finance.payment.created"));
      await refresh();
    } catch (error) {
      const reason = error instanceof Error ? error.message : "error";
      toast.error(
        reason === "provider_not_configured"
          ? t("finance.payment.notConfigured")
          : t("finance.payment.error"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
    toast.success(t("finance.payment.copied"));
  }

  if (loading) return <CenterLoader />;

  if (!data) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-sm text-muted-foreground">{t("finance.portal.invalidToken")}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/$lang/secure/application/$token"
          params={{ lang, token }}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> {t("finance.payment.back")}
        </Link>
        <LanguageSwitcher />
      </div>

      <header>
        <h1 className="font-serif text-2xl font-semibold tracking-tight">{t("finance.payment.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("finance.payment.subtitle")} · <span className="font-mono">{data.reference}</span>
        </p>
      </header>

      <Card className="space-y-3 p-5">
        <h2 className="text-sm font-semibold">{t("finance.payment.due")}</h2>
        {data.dues.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("finance.payment.noDue")}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {data.dues.map((d) => (
              <button
                key={d.purpose}
                type="button"
                onClick={() => setPurpose(d.purpose)}
                className={`rounded-xl border px-4 py-3 text-left text-sm transition ${
                  purpose === d.purpose ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                }`}
              >
                <span className="block font-medium">{t(`finance.payment.purpose.${d.purpose}`)}</span>
                <span className="block text-muted-foreground">
                  {formatMoney(d.amount, d.currency, i18next.language)} ·{" "}
                  {t(`finance.payment.feeStatus.${d.status}`, { defaultValue: d.status })}
                </span>
              </button>
            ))}
          </div>
        )}
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="text-sm font-semibold">{t("finance.payment.methods")}</h2>
        {data.methods.length === 0 ? (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-700">
            {t("finance.payment.noMethods")}
          </p>
        ) : (
          <ul className="space-y-2">
            {data.methods.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => setSelected(m.id)}
                  className={`flex w-full items-center gap-3 rounded-xl border p-4 text-left transition ${
                    selected === m.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                  }`}
                >
                  <MethodBrands kind={m.kind} provider={m.provider} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{m.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {t(`finance.payment.kind.${m.kind}`, { defaultValue: m.kind })}
                      {m.bank_name ? ` · ${m.bank_name}` : ""}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="flex items-start gap-2 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {t("finance.payment.notice")}
        </p>

        <Button disabled={busy || !selected || !due} onClick={() => void pay()}>
          {t("finance.payment.pay")}
        </Button>
      </Card>

      {intent && !intent.redirectUrl && (
        <Card className="space-y-3 p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4 text-primary" /> {t("finance.payment.instructions")}
          </h2>
          <div className="rounded-xl border border-border p-4">
            <Row label={t("finance.payment.reference")} value={intent.reference} />
            <Row label={t("finance.payment.holder")} value={intent.method.holder} />
            <Row label="IBAN" value={intent.method.iban} />
            <Row label="BIC" value={intent.method.bic} />
            <Row label={t("finance.payment.bank")} value={intent.method.bank_name} />
            <Row label={t("finance.payment.address")} value={intent.method.address} />
            <Row label={t("finance.payment.network")} value={intent.method.network} />
          </div>
          {intent.method.instructions && (
            <p className="text-sm text-muted-foreground">{intent.method.instructions}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => void copy(intent.reference)}>
              <Copy className="mr-1.5 h-3.5 w-3.5" /> {t("finance.payment.copyReference")}
            </Button>
            {intent.method.iban && (
              <Button variant="outline" size="sm" onClick={() => void copy(intent.method.iban ?? "")}>
                <Copy className="mr-1.5 h-3.5 w-3.5" /> IBAN
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{t("finance.payment.createdHint")}</p>
        </Card>
      )}

      <Card className="space-y-2 p-5">
        <h2 className="text-sm font-semibold">{t("finance.payment.history")}</h2>
        {data.payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("finance.payment.noPaymentYet")}</p>
        ) : (
          <ul className="space-y-2">
            {data.payments.map((p) => (
              <li key={p.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{t(`finance.payment.purpose.${p.purpose}`, { defaultValue: p.purpose })}</span>
                  <span className="font-mono text-xs text-muted-foreground">{p.reference}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatMoney(Number(p.amount), p.currency ?? "EUR", i18next.language)} ·{" "}
                  {t(`finance.payment.status.${p.status}`, { defaultValue: p.status })} ·{" "}
                  {new Date(p.created_at).toLocaleDateString(i18next.language)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
