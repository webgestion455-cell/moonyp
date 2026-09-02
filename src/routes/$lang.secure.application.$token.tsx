import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertCircle,
  BadgeEuro,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  FileText,
  Landmark,
  Percent,
  RefreshCw,
  ShieldCheck,
  User,
} from "lucide-react";
import i18n from "@/i18n";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CenterLoader } from "@/components/ui/loader";
import { StatusBadge } from "@/components/StatusBadge";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { toast } from "sonner";
import { getApplicationByToken, respondToInfoRequest } from "@/lib/applications.functions";
import { formatMoney } from "@/lib/loan-math";
import { documentLabel } from "@/lib/document-labels";
import {
  CLIENT_TIMELINE,
  isTerminal,
  statusLabel,
  type ApplicationStatus,
} from "@/lib/application-status";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/$lang/secure/application/$token")({
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

type Payload = Awaited<ReturnType<typeof getApplicationByToken>>;

const kindSuffix = (k: string) =>
  ({
    missing_document: "MissingDocument",
    replace_document: "ReplaceDocument",
    information: "Information",
    justification: "Justification",
  })[k] ?? "Information";

function SecurePortal() {
  const { token } = Route.useParams();
  const { t, i18n: i18next } = useTranslation();
  const fetchFile = useServerFn(getApplicationByToken);

  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const respond = useServerFn(respondToInfoRequest);
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);

  async function sendReply(requestId: string) {
    const value = (replies[requestId] ?? "").trim();
    if (value.length < 2 || sending) return;
    setSending(true);
    try {
      await respond({ data: { token, request_id: requestId, response: value } });
      setReplies((p) => ({ ...p, [requestId]: "" }));
      toast.success(t("finance.portal.requests.success"));
      await load();
    } catch {
      toast.error(t("finance.portal.requests.error"));
    } finally {
      setSending(false);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchFile({ data: { token } });
      setData(result);
      setFailed(!result);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [fetchFile, token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <CenterLoader />;

  if (failed || !data) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <div className="mb-8 flex justify-end">
          <LanguageSwitcher />
        </div>
        <AlertCircle className="mx-auto h-10 w-10 text-destructive" aria-hidden />
        <h1 className="mt-4 font-serif text-2xl font-medium">{t("finance.portal.invalidTitle")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("finance.portal.invalidDesc")}</p>
      </div>
    );
  }

  const app = data.application as unknown as Record<string, unknown>;
  const locale = i18next.resolvedLanguage ?? "en";
  const currency = (data.product?.currency as string | undefined) ?? "EUR";
  const status = app.status as ApplicationStatus;
  const num = (k: string) => (app[k] === null || app[k] === undefined ? null : Number(app[k]));
  const money = (v: number | null) => (v === null ? "—" : formatMoney(v, currency, locale));
  const date = (v: unknown) =>
    typeof v === "string" ? new Date(v).toLocaleDateString(locale, { day: "2-digit", month: "long", year: "numeric" }) : "—";

  const fullName = [app.first_name, app.last_name].filter(Boolean).join(" ") || String(app.email ?? "");
  const monthly = (num("monthly_payment") ?? 0) + (num("insurance_monthly") ?? 0);
  const stageIndex = CLIENT_TIMELINE.indexOf(status);
  const progress = isTerminal(status)
    ? 100
    : Math.round(((Math.max(stageIndex, 0) + 1) / CLIENT_TIMELINE.length) * 100);

  const history = (data.history ?? []) as Array<{ new_status: string; created_at: string; note?: string | null }>;
  const infoRequests = (data.infoRequests ?? []) as Array<{
    id: string;
    kind: string;
    message: string;
    status: string;
    document_type_slug: string | null;
    response_text: string | null;
  }>;
  const documents = (data.documents ?? []) as Array<{
    id: string;
    document_type_slug: string;
    file_name: string;
    status: string;
    review_note: string | null;
    created_at: string;
  }>;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-28 pt-8 sm:px-6 lg:px-8">
      {/* Sélecteur de langue : conserve le token et la route courante. */}
      <div className="mb-4 flex justify-end">
        <LanguageSwitcher />
      </div>

      {/* ---------------------------- Header ---------------------------- */}
      <header className="overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              {t("finance.portal.reference")}
            </p>
            <h1 className="mt-1 truncate font-mono text-2xl font-bold tracking-tight sm:text-3xl">
              {String(app.reference ?? "")}
            </h1>
            <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
              <User className="h-3.5 w-3.5" aria-hidden />
              <span className="truncate">{fullName}</span>
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <StatusBadge status={status} />
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/70 px-3 py-1 text-[11px] font-medium text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-success" aria-hidden />
              {t("finance.portal.secure")}
            </span>
          </div>
        </div>

        <div className="mt-6">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{t("finance.portal.progress")}</span>
            <span className="tabular-nums font-medium">{progress}%</span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full transition-all duration-700", status === "rejected" ? "bg-destructive" : "bg-primary")}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <CalendarClock className="h-3.5 w-3.5" aria-hidden />
            {t("finance.portal.submittedOn")} {date(app.submitted_at ?? app.created_at)}
          </span>
          <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            {t("common.refresh")}
          </Button>
        </div>
      </header>

      {/* --------------------------- Key figures ------------------------- */}
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure icon={BadgeEuro} label={t("finance.sim.amount")} value={money(num("amount"))} />
        <Figure
          icon={CalendarClock}
          label={t("finance.sim.duration")}
          value={`${num("duration_months") ?? "—"} ${t("finance.sim.months")}`}
        />
        <Figure icon={Landmark} label={t("finance.portal.monthly")} value={money(monthly || null)} />
        <Figure
          icon={Percent}
          label={t("finance.portal.apr")}
          value={num("apr") === null ? "—" : `${(num("apr") as number).toFixed(2)} %`}
        />
      </div>

      {/* ----------------------------- Detail ---------------------------- */}
      <div className="mt-5 grid gap-5 lg:grid-cols-5">
        <Card className="p-5 lg:col-span-3">
          <h2 className="text-sm font-semibold">{t("finance.portal.summary")}</h2>
          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
            <Row label={t("finance.portal.product")} value={(data.product?.name as string | undefined) ?? "—"} />
            <Row label={t("finance.portal.status")} value={statusLabel(status)} />
            <Row label={t("finance.portal.insurance")} value={app.insurance_opted ? t("common.yes") : t("common.no")} />
            <Row label={t("finance.portal.totalCost")} value={money(num("total_cost"))} />
            <Row label={t("finance.portal.interest")} value={money(num("total_interest"))} />
            <Row label={t("finance.portal.fees")} value={money(num("fees"))} />
            <Row label={t("finance.fields.iban")} value={maskIban(String(app.bank_iban ?? ""))} />
            <Row label={t("finance.fields.bankHolder")} value={String(app.bank_holder ?? "—")} />
          </dl>
        </Card>

        <Card className="p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold">{t("finance.portal.timeline")}</h2>
          {history.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">{t("common.noResults")}</p>
          ) : (
            <ol className="mt-4 space-y-4">
              {history.map((h, index) => {
                const last = index === history.length - 1;
                return (
                  <li key={`${h.created_at}-${index}`} className="relative flex gap-3 pb-1">
                    {!last && <span className="absolute left-[11px] top-6 h-full w-px bg-border" aria-hidden />}
                    <span
                      className={cn(
                        "relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                        last ? "bg-primary text-primary-foreground" : "bg-success/15 text-success",
                      )}
                    >
                      {last ? <CircleDashed className="h-3.5 w-3.5" aria-hidden /> : <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{statusLabel(h.new_status as ApplicationStatus)}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(h.created_at).toLocaleString(locale)}
                      </p>
                      {h.note && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{h.note}</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
      </div>

      {/* ------------------ Informations demandées ----------------------- */}
      {infoRequests.length > 0 && (
        <Card className="mt-5 p-5">
          <h2 className="text-sm font-semibold">{t("finance.portal.requests.title")}</h2>
          <ul className="mt-4 space-y-3">
            {infoRequests.map((r) => (
              <li key={r.id} className="rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">
                    {t(`finance.portal.requests.kind${kindSuffix(r.kind)}`, { defaultValue: r.kind })}
                    {r.document_type_slug ? ` · ${documentLabel(t, r.document_type_slug)}` : ""}
                  </p>
                  <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">
                    {t(`finance.portal.requests.${r.status}`, { defaultValue: r.status })}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{r.message}</p>
                {r.status === "open" ? (
                  <div className="mt-3 space-y-2">
                    <textarea
                      className="min-h-20 w-full rounded-md border border-input bg-background p-3 text-sm"
                      value={replies[r.id] ?? ""}
                      onChange={(e) => setReplies((p) => ({ ...p, [r.id]: e.target.value }))}
                      maxLength={2000}
                      placeholder={t("finance.portal.requests.placeholder")}
                    />
                    <Button
                      size="sm"
                      disabled={sending || (replies[r.id] ?? "").trim().length < 2}
                      onClick={() => void sendReply(r.id)}
                    >
                      {t("finance.portal.requests.submit")}
                    </Button>
                  </div>
                ) : (
                  r.response_text && (
                    <p className="mt-2 rounded-md bg-muted p-3 text-sm">{r.response_text}</p>
                  )
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}



      {/* ---------------------------- Documents -------------------------- */}
      <Card className="mt-5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{t("finance.portal.documents")}</h2>
          <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
            {t(`finance.portal.kyc.${String(app.kyc_status ?? "pending")}`, {
              defaultValue: String(app.kyc_status ?? "—"),
            })}
          </span>
        </div>
        {documents.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">{t("finance.portal.noDocuments")}</p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {documents.map((d) => (
              <li key={d.id} className="flex items-center gap-3 py-3">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {documentLabel(t as never, d.document_type_slug)}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{d.file_name}</span>
                  {d.review_note && <span className="block text-xs text-destructive">{d.review_note}</span>}
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium",
                    d.status === "approved"
                      ? "bg-success/15 text-success"
                      : d.status === "rejected" || d.status === "replacement_requested"
                        ? "bg-destructive/15 text-destructive"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {t(`finance.portal.doc.${d.status}`, { defaultValue: d.status })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="mt-6 rounded-xl bg-muted/50 p-4 text-xs leading-relaxed text-muted-foreground">
        {t("finance.portal.help")}
      </p>
    </div>
  );
}

function Figure({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden />
      </div>
      <p className="mt-2 break-words font-serif text-lg font-semibold sm:text-xl">{value}</p>
    </Card>
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

function maskIban(iban: string): string {
  const clean = iban.replace(/\s+/g, "");
  if (clean.length < 8) return clean || "—";
  return `${clean.slice(0, 4)} •••• •••• ${clean.slice(-4)}`;
}
