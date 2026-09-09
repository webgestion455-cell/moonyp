import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertCircle,
  BadgeEuro,
  Banknote,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  Circle,
  Download,
  FileSignature,
  FileText,
  Landmark,
  Percent,
  RefreshCw,
  ShieldCheck,
  Umbrella,
  User,
} from "lucide-react";
import i18n from "@/i18n";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CenterLoader } from "@/components/ui/loader";
import { StatusBadge } from "@/components/StatusBadge";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { toast } from "sonner";
import {
  getApplicationByToken,
  getSecureDocumentUrl,
  listDocumentTypes,
  respondToInfoRequest,
} from "@/lib/applications.functions";
import { PortalUpload, type PortalDocumentType } from "@/components/finance/PortalUpload";
import { chooseGuaranteeOption, type GuaranteeChoice } from "@/lib/guarantees.functions";
import { formatMoney } from "@/lib/loan-math";
import { documentLabel } from "@/lib/document-labels";
import { isTerminal, statusLabel, type ApplicationStatus } from "@/lib/application-status";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/$lang/secure/application/$token/")({
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

/**
 * Étapes visibles par le client. Chaque étape est « atteinte » dès que le
 * dossier a franchi l'un de ses statuts déclencheurs : la timeline reflète
 * donc toujours l'état réel en base, jamais une progression décorative.
 */
const STAGES: Array<{ key: string; statuses: ApplicationStatus[] }> = [
  { key: "received", statuses: ["received"] },
  { key: "study", statuses: ["verification", "documents_missing", "analysis", "info_requested"] },
  { key: "approved", statuses: ["approved", "offer_available"] },
  { key: "contract", statuses: ["contract_sent", "signature_pending", "contract_signed"] },
  { key: "guarantee", statuses: ["guarantee_sent", "guarantee_signed"] },
  { key: "insurance", statuses: ["insurance_pending", "insurance_validated"] },
  { key: "disbursement", statuses: ["disbursement_preparing", "disbursed"] },
  { key: "repayment", statuses: ["repaying", "late", "repaid"] },
];

function SecurePortal() {
  const { lang, token } = Route.useParams();
  const { t, i18n: i18next } = useTranslation();
  const fetchFile = useServerFn(getApplicationByToken);
  const fetchDocUrl = useServerFn(getSecureDocumentUrl);
  const chooseGuarantee = useServerFn(chooseGuaranteeOption);

  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const respond = useServerFn(respondToInfoRequest);
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [choice, setChoice] = useState<GuaranteeChoice | "">("");
  const fetchDocTypes = useServerFn(listDocumentTypes);
  const [docTypes, setDocTypes] = useState<PortalDocumentType[]>([]);
  const [payDate, setPayDate] = useState("");

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

  // Catalogue des pièces acceptées : même source que le parcours de souscription.
  useEffect(() => {
    void fetchDocTypes({})
      .then((rows) => setDocTypes(rows as unknown as PortalDocumentType[]))
      .catch(() => setDocTypes([]));
  }, [fetchDocTypes]);

  /**
   * Atterrissage précis : les boutons des emails pointent vers une ancre
   * (#info-requests, #documents, #guarantee…). Une fois le dossier chargé, on
   * amène le client exactement à la section concernée et on la met en avant,
   * pour qu'il n'ait jamais à chercher dans la page.
   */
  useEffect(() => {
    if (!data || typeof window === "undefined") return;
    const id = window.location.hash.replace("#", "");
    if (!id) return;
    const target = document.getElementById(id);
    if (!target) return;
    const timer = window.setTimeout(() => {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      target.classList.add("ring-2", "ring-primary", "ring-offset-2", "ring-offset-background");
      window.setTimeout(
        () => target.classList.remove("ring-2", "ring-primary", "ring-offset-2", "ring-offset-background"),
        2600,
      );
    }, 180);
    return () => window.clearTimeout(timer);
  }, [data]);

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

  /** Choix du client sur les frais de garantie — n'emporte aucun paiement. */
  async function submitGuaranteeChoice(guaranteeId: string) {
    if (!choice || sending) return;
    if (choice === "pay_later" && !payDate) {
      toast.error(t("finance.guarantee.error.dateRequired"));
      return;
    }
    setSending(true);
    try {
      const res = await chooseGuarantee({
        data: {
          token,
          guarantee_id: guaranteeId,
          choice,
          scheduled_payment_date: choice === "pay_later" ? payDate : undefined,
        },
      });
      if (!res.ok) {
        toast.error(t((res as { reason: string }).reason, { defaultValue: t("finance.guarantee.error.generic") }));
        return;
      }
      toast.success(t("finance.guarantee.choiceSaved"));
      await load();
    } catch {
      toast.error(t("finance.guarantee.error.generic"));
    } finally {
      setSending(false);
    }
  }



  /** Ouvre une URL signée éphémère (2 min), jamais un chemin de stockage. */
  async function openDocument(kind: "document" | "contract" | "signed_contract", documentId?: string) {
    try {
      const res = await fetchDocUrl({ data: { token, kind, document_id: documentId } });
      window.open(res.url, "_blank", "noopener,noreferrer");
    } catch {
      toast.error(t("finance.portal.downloadError"));
    }
  }

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
  const money = (v: number | null | undefined, cur = currency) =>
    v === null || v === undefined ? "—" : formatMoney(Number(v), cur, locale);
  const date = (v: unknown) =>
    typeof v === "string"
      ? new Date(v).toLocaleDateString(locale, { day: "2-digit", month: "long", year: "numeric" })
      : "—";

  const fullName = [app.first_name, app.last_name].filter(Boolean).join(" ") || String(app.email ?? "");
  const monthly = (num("monthly_payment") ?? 0) + (num("insurance_monthly") ?? 0);

  const history = (data.history ?? []) as Array<{
    new_status: string;
    created_at: string;
    note?: string | null;
    reason?: string | null;
  }>;
  const reached = new Set(history.map((h) => h.new_status));
  reached.add(status);
  const rejected = status === "rejected" || status === "cancelled";

  const stageState = STAGES.map((s) => {
    const isCurrent = s.statuses.includes(status);
    const isDone = !isCurrent && s.statuses.some((x) => reached.has(x));
    return { ...s, isCurrent, isDone };
  });
  const lastDone = stageState.reduce((acc, s, i) => (s.isDone || s.isCurrent ? i : acc), -1);
  const progress = isTerminal(status) && !rejected ? 100 : Math.round(((lastDone + 1) / STAGES.length) * 100);

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
  const kycChecks = (data.kycChecks ?? []) as Array<{
    id: string;
    category: string;
    document_type_slug: string | null;
    status: string;
    review_note: string | null;
  }>;
  const offer = data.offer;
  const contract = data.contract;
  const guarantee = data.guarantee;
  const insurance = data.insurance;
  const disbursement = data.disbursement;
  const repayments = (data.repayments ?? []) as Array<{
    id: string;
    installment_no: number;
    due_date: string;
    amount: number;
    remaining_balance: number;
    paid: boolean;
    paid_at: string | null;
  }>;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-28 pt-8 sm:px-6 lg:px-8">
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
              className={cn("h-full rounded-full transition-all duration-700", rejected ? "bg-destructive" : "bg-primary")}
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

      {/* ------------------------- Payment call to action ---------------- */}
      {(() => {
        const pending = (s: unknown) =>
          typeof s === "string" && !["paid", "not_required", "cancelled"].includes(s);
        const hasDue = pending(guarantee?.payment_status) || pending(insurance?.payment_status);
        if (!hasDue) return null;
        return (
          <Card className="mt-5 flex flex-wrap items-center justify-between gap-3 border-primary/40 bg-primary/5 p-5">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <BadgeEuro className="h-4 w-4 text-primary" aria-hidden />
                {t("finance.payment.title")}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">{t("finance.payment.subtitle")}</p>
            </div>
            <Button asChild>
              <Link to="/$lang/secure/application/$token/payment" params={{ lang, token }}>
                {t("finance.payment.pay")}
              </Link>
            </Button>
          </Card>
        );
      })()}



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

      {/* --------------------------- Stage timeline ---------------------- */}
      <Card className="mt-5 p-5">
        <h2 className="text-sm font-semibold">{t("finance.portal.timeline")}</h2>
        <ol className="mt-4 space-y-3">
          {stageState.map((s, index) => (
            <li key={s.key} className="relative flex gap-3">
              {index < stageState.length - 1 && (
                <span className="absolute left-[11px] top-6 h-[calc(100%-0.5rem)] w-px bg-border" aria-hidden />
              )}
              <span
                className={cn(
                  "relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                  s.isDone
                    ? "bg-success/15 text-success"
                    : s.isCurrent
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {s.isDone ? (
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                ) : s.isCurrent ? (
                  <CircleDashed className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <Circle className="h-3 w-3" aria-hidden />
                )}
              </span>
              <p className={cn("pt-0.5 text-sm", s.isDone || s.isCurrent ? "font-medium" : "text-muted-foreground")}>
                {t(`finance.portal.stages.${s.key}`)}
              </p>
            </li>
          ))}
        </ol>
      </Card>

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
          <h2 className="text-sm font-semibold">{t("finance.portal.status")}</h2>
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
                      <p className="text-xs text-muted-foreground">{new Date(h.created_at).toLocaleString(locale)}</p>
                      {(h.reason || h.note) && (
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{h.reason || h.note}</p>
                      )}
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
        <Card id="info-requests" className="mt-5 scroll-mt-24 p-5">
          <h2 className="text-sm font-semibold">{t("finance.portal.requests.title")}</h2>
          <ul className="mt-4 space-y-3">
            {infoRequests.map((r) => (
              <li key={r.id} className="rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">
                    {t(`finance.portal.requests.kind${kindSuffix(r.kind)}`, { defaultValue: r.kind })}
                    {r.document_type_slug ? ` · ${documentLabel(t as never, r.document_type_slug)}` : ""}
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
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        disabled={sending || (replies[r.id] ?? "").trim().length < 2}
                        onClick={() => void sendReply(r.id)}
                      >
                        {t("finance.portal.requests.submit")}
                      </Button>

                      {/* Dépôt de la pièce demandée, sans quitter la réponse. */}
                      <PortalUpload
                        compact
                        token={token}
                        documentTypes={docTypes}
                        fixedSlug={r.document_type_slug}
                        onUploaded={async (fileName) => {
                          setReplies((p) => ({
                            ...p,
                            [r.id]: `${(p[r.id] ?? "").trim()}\n${t("finance.portal.upload.attached", {
                              name: fileName,
                            })}`.trim(),
                          }));
                          await load();
                        }}
                      />
                    </div>
                  </div>
                ) : (
                  r.response_text && <p className="mt-2 rounded-md bg-muted p-3 text-sm">{r.response_text}</p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ---------------------------- Documents -------------------------- */}
      <Card id="documents" className="mt-5 scroll-mt-24 p-5">
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
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  aria-label={t("finance.portal.download")}
                  onClick={() => void openDocument("document", d.id)}
                >
                  <Download className="h-4 w-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
        {/* Dépôt / remplacement d'une pièce manquante par le client. */}
        <div className="mt-4 rounded-xl border border-dashed border-border p-4">
          <p className="text-sm font-medium">{t("finance.portal.upload.title")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("finance.portal.upload.desc")}</p>
          <PortalUpload
            token={token}
            documentTypes={docTypes}
            onUploaded={async () => {
              await load();
            }}
          />
        </div>

        <p className="mt-3 text-[11px] text-muted-foreground">{t("finance.portal.downloadNotice")}</p>
      </Card>

      {/* ------------------------------- KYC ----------------------------- */}
      <Card id="kyc" className="mt-5 scroll-mt-24 p-5">
        <h2 className="text-sm font-semibold">{t("finance.portal.kycTitle")}</h2>
        {kycChecks.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">{t("finance.portal.kycNone")}</p>
        ) : (
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {kycChecks.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm">
                <span className="min-w-0 truncate">
                  {c.document_type_slug
                    ? documentLabel(t as never, c.document_type_slug)
                    : t(`kyc.categories.${c.category}`, { defaultValue: c.category })}
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium",
                    c.status === "passed"
                      ? "bg-success/15 text-success"
                      : c.status === "failed"
                        ? "bg-destructive/15 text-destructive"
                        : "bg-background text-muted-foreground",
                  )}
                >
                  {t(`finance.portal.kyc.${c.status === "passed" ? "passed" : c.status === "failed" ? "failed" : "verifying"}`)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ------------------------------ Offer ---------------------------- */}
      {offer && (
        <Card id="offer" className="mt-5 scroll-mt-24 p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <BadgeEuro className="h-4 w-4 text-primary" aria-hidden />
            {t("finance.portal.offer")}
          </h2>
          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
            <Row label={t("finance.sim.amount")} value={money(offer.amount, offer.currency)} />
            <Row label={t("finance.sim.duration")} value={`${offer.duration_months} ${t("finance.sim.months")}`} />
            <Row label={t("finance.portal.monthly")} value={money(offer.monthly_payment, offer.currency)} />
            <Row label={t("finance.portal.totalCost")} value={money(offer.total_cost, offer.currency)} />
            <Row label={t("finance.portal.validUntil")} value={date(offer.valid_until)} />
            <Row label={t("finance.portal.acceptedOn")} value={date(offer.accepted_at)} />
          </dl>
        </Card>
      )}

      {/* ----------------------------- Contract -------------------------- */}
      {contract && (
        <Card id="contract" className="mt-5 scroll-mt-24 p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <FileSignature className="h-4 w-4 text-primary" aria-hidden />
            {t("finance.portal.contract")}
          </h2>
          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
            <Row label={t("finance.portal.sentOn")} value={date(contract.sent_at)} />
            <Row label={t("finance.portal.signedOn")} value={date(contract.signed_at)} />
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild size="sm" className="gap-2">
              <Link to="/$lang/secure/application/$token/contract" params={{ lang, token }}>
                <FileSignature className="h-4 w-4" aria-hidden />
                {t("finance.portal.viewContract")}
              </Link>
            </Button>
            {contract.has_document && (
              <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => void openDocument("contract")}>
                <Download className="h-4 w-4" aria-hidden />
                {t("finance.portal.downloadContract")}
              </Button>
            )}
            {contract.has_signed_document && (
              <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => void openDocument("signed_contract")}>
                <Download className="h-4 w-4" aria-hidden />
                {t("finance.portal.downloadSigned")}
              </Button>
            )}
          </div>
        </Card>
      )}

      {/* ----------------------------- Guarantee ------------------------- */}
      {guarantee && (
        <Card id="guarantee" className="mt-5 scroll-mt-24 p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />
            {t("finance.portal.guarantee")}
          </h2>
          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
            <Row label={t("finance.guarantee.fee")} value={money(Number(guarantee.fee_amount ?? guarantee.amount), guarantee.currency)} />
            <Row
              label={t("finance.guarantee.paymentStatus")}
              value={t(`finance.guarantee.payment.${guarantee.payment_status ?? "unpaid"}`, {
                defaultValue: String(guarantee.payment_status ?? "—"),
              })}
            />
            <Row label={t("finance.portal.sentOn")} value={date(guarantee.sent_at)} />
            {guarantee.scheduled_payment_date && (
              <Row label={t("finance.guarantee.scheduledDate")} value={date(guarantee.scheduled_payment_date)} />
            )}
          </dl>
          {guarantee.fee_description && (
            <p className="mt-3 text-sm text-muted-foreground">{guarantee.fee_description}</p>
          )}

          {guarantee.payment_status === "paid" ? (
            <p className="mt-4 rounded-lg bg-success/10 p-3 text-sm text-success">
              {t("finance.guarantee.paidNotice")}
            </p>
          ) : guarantee.client_choice ? (
            <div className="mt-4 space-y-3">
              <p className="rounded-lg bg-muted/50 p-3 text-sm">
                {t(`finance.guarantee.chosen.${guarantee.client_choice}`, { defaultValue: guarantee.client_choice })}
              </p>
              {guarantee.client_choice !== "decline" && guarantee.payment_instructions && (
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("finance.guarantee.instructions")}
                  </p>
                  <p className="mt-1 whitespace-pre-line text-sm">{guarantee.payment_instructions}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{t("finance.guarantee.validationNotice")}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <p className="text-sm font-medium">{t("finance.guarantee.question")}</p>
              <div className="space-y-2">
                {(["pay_now", "decline", "pay_later"] as GuaranteeChoice[]).map((option) => (
                  <label
                    key={option}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm transition-colors",
                      choice === option ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40",
                    )}
                  >
                    <input
                      type="radio"
                      name="guarantee-choice"
                      className="mt-1"
                      checked={choice === option}
                      onChange={() => setChoice(option)}
                    />
                    <span>
                      <span className="block font-medium">{t(`finance.guarantee.options.${option}`)}</span>
                      <span className="block text-xs text-muted-foreground">
                        {t(`finance.guarantee.optionsHint.${option}`)}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              {choice === "pay_later" && (
                <label className="block text-sm">
                  <span className="mb-1.5 block font-medium">{t("finance.guarantee.pickDate")}</span>
                  <input
                    type="date"
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={payDate}
                    min={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setPayDate(e.target.value)}
                  />
                </label>
              )}
              <Button size="sm" disabled={sending || !choice} onClick={() => void submitGuaranteeChoice(guarantee.id)}>
                {t("finance.guarantee.confirmChoice")}
              </Button>
              <p className="text-xs text-muted-foreground">{t("finance.guarantee.noPaymentNotice")}</p>
            </div>
          )}
        </Card>
      )}

      {/* ----------------------------- Insurance ------------------------- */}
      {insurance && (
        <Card id="insurance" className="mt-5 scroll-mt-24 p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Umbrella className="h-4 w-4 text-primary" aria-hidden />
            {t("finance.portal.insurance")}
          </h2>
          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
            <Row label={t("finance.portal.provider")} value={insurance.provider ?? "—"} />
            <Row label={t("finance.portal.policy")} value={insurance.policy_number ?? "—"} />
            <Row label={t("finance.portal.premium")} value={money(insurance.monthly_premium, insurance.currency)} />
            <Row label={t("finance.portal.signedOn")} value={date(insurance.validated_at)} />
          </dl>
        </Card>
      )}

      {/* --------------------------- Disbursement ------------------------ */}
      {disbursement && (
        <Card id="disbursement" className="mt-5 scroll-mt-24 p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Banknote className="h-4 w-4 text-primary" aria-hidden />
            {t("finance.portal.disbursement")}
          </h2>
          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
            <Row label={t("finance.sim.amount")} value={money(disbursement.amount, disbursement.currency)} />
            <Row label={t("finance.portal.beneficiary")} value={disbursement.beneficiary ?? "—"} />
            <Row label={t("finance.fields.iban")} value={disbursement.iban || "—"} />
            <Row label={t("finance.portal.sentOn")} value={date(disbursement.processed_at)} />
          </dl>
        </Card>
      )}

      {/* ---------------------------- Repayments ------------------------- */}
      {repayments.length > 0 && (
        <Card id="repayments" className="mt-5 scroll-mt-24 p-5">
          <h2 className="text-sm font-semibold">{t("finance.portal.repayments")}</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">{t("finance.portal.installment")}</th>
                  <th className="py-2 pr-3 font-medium">{t("finance.portal.dueDate")}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t("finance.sim.amount")}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t("finance.portal.remaining")}</th>
                  <th className="py-2 text-right font-medium">{t("finance.portal.status")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {repayments.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2 pr-3 tabular-nums">{r.installment_no}</td>
                    <td className="py-2 pr-3">{date(r.due_date)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{money(r.amount)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{money(r.remaining_balance)}</td>
                    <td className="py-2 text-right">
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-1 text-[11px] font-medium",
                          r.paid ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
                        )}
                      >
                        {r.paid ? t("finance.portal.paid") : t("finance.portal.unpaid")}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

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
