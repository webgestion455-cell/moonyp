import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import { AlertCircle, ArrowLeft, Download, FileSignature, Info, ShieldCheck } from "lucide-react";
import i18n from "@/i18n";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CenterLoader } from "@/components/ui/loader";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { toast } from "sonner";
import {
  getContractByToken,
  requestContractSignature,
  signContract,
} from "@/lib/contracts.functions";
import { getSecureDocumentUrl } from "@/lib/applications.functions";
import { formatMoney } from "@/lib/loan-math";
import { statusLabel, type ApplicationStatus } from "@/lib/application-status";

export const Route = createFileRoute("/$lang/secure/application/$token/contract")({
  component: ContractPage,
  head: () => ({
    meta: [
      { title: i18n.t("finance.contract.metaTitle") },
      { name: "description", content: i18n.t("finance.contract.metaDesc") },
      { property: "og:title", content: i18n.t("finance.contract.metaTitle") },
      { property: "og:description", content: i18n.t("finance.contract.metaDesc") },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

type Payload = Awaited<ReturnType<typeof getContractByToken>>;

function ContractPage() {
  const { lang, token } = Route.useParams();
  const { t, i18n: i18next } = useTranslation();
  const load = useServerFn(getContractByToken);
  const startSignature = useServerFn(requestContractSignature);
  const finalize = useServerFn(signContract);
  const fetchDocUrl = useServerFn(getSecureDocumentUrl);

  const [data, setData] = useState<Payload>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [fullName, setFullName] = useState("");
  const [code, setCode] = useState("");
  const [consent, setConsent] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setData(await load({ data: { token } }));
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [load, token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function openDocument(kind: "contract" | "signed_contract") {
    try {
      const res = await fetchDocUrl({ data: { token, kind } });
      window.open(res.url, "_blank", "noopener,noreferrer");
    } catch {
      toast.error(t("finance.portal.downloadError"));
    }
  }

  async function onStart() {
    if (busy || fullName.trim().length < 3) return;
    setBusy(true);
    try {
      const res = await startSignature({ data: { token, full_name: fullName.trim() } });
      if ("alreadySigned" in res && res.alreadySigned) {
        toast.info(t("finance.contract.alreadySigned"));
        await refresh();
        return;
      }
      setRequestId((res as { request_id: string }).request_id);
      toast.success(t("finance.contract.codeSent"));
    } catch {
      toast.error(t("finance.contract.startError"));
    } finally {
      setBusy(false);
    }
  }

  async function onSign() {
    if (busy || !requestId || code.trim().length < 4 || !consent) return;
    setBusy(true);
    try {
      const res = await finalize({
        data: { token, request_id: requestId, code: code.trim(), full_name: fullName.trim(), consent: true },
      });
      if (!res.ok) {
        toast.error(t((res as { reason: string }).reason, { defaultValue: t("finance.contract.signError") }));
        return;
      }
      toast.success(t("finance.contract.signed"));
      setCode("");
      setRequestId(null);
      await refresh();
    } catch {
      toast.error(t("finance.contract.signError"));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <CenterLoader />;

  if (!data) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <AlertCircle className="mx-auto h-10 w-10 text-destructive" aria-hidden />
        <h1 className="mt-4 font-serif text-2xl font-medium">{t("finance.portal.invalidTitle")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("finance.portal.invalidDesc")}</p>
      </div>
    );
  }

  const locale = i18next.resolvedLanguage ?? "en";
  const app = data.application;
  const offer = data.offer;
  const contract = data.contract;
  const currency = (offer?.currency as string | undefined) ?? "EUR";
  const money = (v: number | null | undefined) => (v == null ? "—" : formatMoney(Number(v), currency, locale));
  const date = (v: string | null | undefined) =>
    v ? new Date(v).toLocaleString(locale, { day: "2-digit", month: "long", year: "numeric" }) : "—";

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-8 sm:px-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link
          to="/$lang/secure/application/$token"
          params={{ lang, token }}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {t("finance.contract.backToFile")}
        </Link>
        <LanguageSwitcher />
      </div>

      <header className="rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-6">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          {t("finance.portal.reference")}
        </p>
        <h1 className="mt-1 font-mono text-2xl font-bold">{app.reference}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {statusLabel(app.status as ApplicationStatus)}
        </p>
      </header>

      {!contract ? (
        <Card className="mt-5 p-6 text-sm text-muted-foreground">{t("finance.contract.notAvailable")}</Card>
      ) : (
        <>
          <Card className="mt-5 p-5">
            <h2 className="text-sm font-semibold">{t("finance.contract.offerSummary")}</h2>
            <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
              <Row label={t("finance.sim.amount")} value={money(offer?.amount ?? app.amount)} />
              <Row
                label={t("finance.sim.duration")}
                value={`${offer?.duration_months ?? app.duration_months ?? "—"} ${t("finance.sim.months")}`}
              />
              <Row
                label={t("finance.contract.rate")}
                value={offer?.annual_rate != null ? `${Number(offer.annual_rate).toFixed(2)} %` : app.apr != null ? `${Number(app.apr).toFixed(2)} %` : "—"}
              />
              <Row label={t("finance.portal.monthly")} value={money(offer?.monthly_payment ?? app.monthly_payment)} />
              <Row label={t("finance.portal.totalCost")} value={money(offer?.total_cost ?? app.total_cost)} />
              <Row label={t("finance.portal.fees")} value={money(offer?.fees_total ?? app.fees)} />
            </dl>
          </Card>

          <Card className="mt-5 p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <FileSignature className="h-4 w-4 text-primary" aria-hidden />
              {t("finance.contract.document")}
            </h2>
            <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
              <Row label={t("finance.contract.version")} value={`v${contract.version}`} />
              <Row
                label={t("finance.contract.state")}
                value={t(`finance.contract.states.${contract.status}`, { defaultValue: contract.status })}
              />
              <Row label={t("finance.portal.sentOn")} value={date(contract.sent_at)} />
              <Row label={t("finance.portal.signedOn")} value={date(contract.signed_at)} />
              <Row
                label={t("finance.contract.hash")}
                value={(contract.signed_document_hash ?? contract.document_hash ?? "—").slice(0, 24)}
              />
              <Row label={t("finance.contract.providerLabel")} value={contract.provider} />
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              {contract.has_document && (
                <Button variant="outline" size="sm" className="gap-2" onClick={() => void openDocument("contract")}>
                  <Download className="h-4 w-4" aria-hidden /> {t("finance.portal.downloadContract")}
                </Button>
              )}
              {contract.has_signed_document && (
                <Button variant="outline" size="sm" className="gap-2" onClick={() => void openDocument("signed_contract")}>
                  <Download className="h-4 w-4" aria-hidden /> {t("finance.portal.downloadSigned")}
                </Button>
              )}
            </div>
          </Card>

          {!contract.signed_at && (
            <Card className="mt-5 p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />
                {t("finance.contract.signTitle")}
              </h2>
              <p className="mt-2 flex gap-2 rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {t("finance.contract.legalNotice")}
              </p>

              <div className="mt-4 space-y-3">
                <label className="block text-sm">
                  <span className="mb-1.5 block font-medium">{t("finance.contract.fullName")}</span>
                  <Input value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={120} />
                </label>

                {!requestId ? (
                  <Button disabled={busy || fullName.trim().length < 3} onClick={() => void onStart()}>
                    {t("finance.contract.startSignature")}
                  </Button>
                ) : (
                  <div className="space-y-3">
                    <label className="block text-sm">
                      <span className="mb-1.5 block font-medium">{t("finance.contract.code")}</span>
                      <Input
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        inputMode="numeric"
                        maxLength={8}
                        className="max-w-[180px] font-mono tracking-widest"
                      />
                      <span className="mt-1 block text-xs text-muted-foreground">{t("finance.contract.codeHint")}</span>
                    </label>
                    <label className="flex items-start gap-2 text-xs leading-relaxed">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={consent}
                        onChange={(e) => setConsent(e.target.checked)}
                      />
                      <span>{t("finance.contract.consent")}</span>
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <Button disabled={busy || code.trim().length < 4 || !consent} onClick={() => void onSign()}>
                        {t("finance.contract.confirmSignature")}
                      </Button>
                      <Button variant="ghost" disabled={busy} onClick={() => void onStart()}>
                        {t("finance.contract.resendCode")}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          )}

          {data.events.length > 0 && (
            <Card className="mt-5 p-5">
              <h2 className="text-sm font-semibold">{t("finance.contract.history")}</h2>
              <ul className="mt-4 space-y-2 text-sm">
                {data.events.map((e, i) => (
                  <li key={`${e.created_at}-${i}`} className="flex flex-wrap justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2">
                    <span>{t(`finance.contract.events.${e.event_type}`, { defaultValue: e.event_type })}</span>
                    <span className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString(locale)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <p className="mt-6 rounded-xl bg-muted/50 p-4 text-xs leading-relaxed text-muted-foreground">
            {t("finance.contract.important")}
          </p>
        </>
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
