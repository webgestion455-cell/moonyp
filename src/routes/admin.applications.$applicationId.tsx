import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, Copy, ExternalLink, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/StatusBadge";
import { CenterLoader } from "@/components/ui/loader";
import { useTranslation } from "react-i18next";
import { statusLabel, type ApplicationStatus } from "@/lib/application-status";
import {
  nextStatuses,
  DECISION_STATUSES,
  REASON_REQUIRED,
  INFO_REQUEST_KINDS,
  type InfoRequestKind,
  type WorkflowContext,
} from "@/lib/application-workflow";

import {
  adminAddInternalNote,
  adminCreateInfoRequest,
  adminCloseInfoRequest,
  adminGetApplication,
  adminIssuePortalLink,
  adminReviewDocument,
  adminReviewKycCheck,
  adminUpdateApplicationStatus,
} from "@/lib/admin-applications.functions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdminFinancePanel } from "@/components/admin/AdminFinancePanel";




export const Route = createFileRoute("/admin/applications/$applicationId")({
  component: ApplicationDetail,
});

type Detail = Awaited<ReturnType<typeof adminGetApplication>>;

function money(n: number | null) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(n ?? 0));
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="break-words text-sm font-medium">{value || "—"}</p>
    </div>
  );
}

function ApplicationDetail() {
  const { applicationId } = Route.useParams();
  const get = useServerFn(adminGetApplication);
  const updateStatus = useServerFn(adminUpdateApplicationStatus);
  const reviewDoc = useServerFn(adminReviewDocument);
  const reviewKyc = useServerFn(adminReviewKycCheck);
  const issueLink = useServerFn(adminIssuePortalLink);

  const createInfoRequest = useServerFn(adminCreateInfoRequest);
  const closeInfoRequest = useServerFn(adminCloseInfoRequest);
  const addInternalNote = useServerFn(adminAddInternalNote);
  const { t } = useTranslation();

  const [internalNote, setInternalNote] = useState("");


  const [data, setData] = useState<Detail>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<ApplicationStatus | null>(null);
  const [reason, setReason] = useState("");
  const [reqKind, setReqKind] = useState<InfoRequestKind>("missing_document");
  const [reqMessage, setReqMessage] = useState("");
  const [reqSlug, setReqSlug] = useState("");

  const load = useCallback(async () => {
    const res = await get({ data: { id: applicationId } });
    setData(res);
    setLoading(false);
  }, [get, applicationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const ctx = (data?.workflowContext ?? {}) as WorkflowContext;
  const transitions = data ? nextStatuses(data.application.status, ctx) : [];
  const blockers = transitions.filter((tr) => !tr.check.ok && tr.check.reason?.startsWith("workflow.guard."))
    .map((tr) => tr.check.reason!)
    .filter((v, i, arr) => arr.indexOf(v) === i);

  // Panneau hiérarchisé : action principale, décisions formelles, autres étapes.
  const decisions = transitions.filter((tr) => DECISION_STATUSES.includes(tr.status));
  const progress = transitions.filter((tr) => !DECISION_STATUSES.includes(tr.status));
  const primary = progress.find((tr) => tr.check.ok) ?? progress[0] ?? null;
  const secondary = progress.filter((tr) => tr.status !== primary?.status);
  const isFinalised = data
    ? ["approved", "rejected", "cancelled", "repaid"].includes(data.application.status) ||
      transitions.length === 0
    : false;


  async function confirmTransition() {
    if (!pending || busy) return;
    if (REASON_REQUIRED.includes(pending) && reason.trim().length < 3) {
      toast.error(t("workflow.error.reasonRequired", { defaultValue: "Un motif est obligatoire." }));
      return;
    }
    setBusy(true);
    try {
      const res = await updateStatus({
        data: {
          id: applicationId,
          status: pending as never,
          note: note || undefined,
          reason: reason || undefined,
        },
      });
      if (res && (res as { ok?: boolean }).ok === false) {
        const key = (res as { reason?: string }).reason ?? "workflow.error.notAllowed";
        toast.error(t(key, { defaultValue: key }));
        return;
      }
      toast.success("Statut mis à jour");
      setNote("");
      setReason("");
      setPending(null);
      await load();
    } catch {
      toast.error("Mise à jour impossible");
    } finally {
      setBusy(false);
    }
  }

  async function saveInternalNote() {
    if (busy || internalNote.trim().length < 2) return;
    setBusy(true);
    try {
      await addInternalNote({ data: { application_id: applicationId, note: internalNote.trim() } });
      setInternalNote("");
      toast.success("Note enregistrée");
      await load();
    } catch {
      toast.error("Enregistrement impossible");
    } finally {
      setBusy(false);
    }
  }



  async function submitInfoRequest() {
    if (busy || reqMessage.trim().length < 3) return;
    setBusy(true);
    try {
      await createInfoRequest({
        data: {
          application_id: applicationId,
          kind: reqKind,
          message: reqMessage,
          document_type_slug: reqSlug || undefined,
          move_status: true,
        },
      });
      toast.success(t("workflow.requests.create", { defaultValue: "Demande envoyée" }));
      setReqMessage("");
      setReqSlug("");
      await load();
    } catch {
      toast.error("Envoi impossible");
    } finally {
      setBusy(false);
    }
  }


  async function review(id: string, status: "approved" | "rejected" | "replacement_requested") {
    try {
      await reviewDoc({ data: { id, status } });
      await load();
    } catch {
      toast.error("Action impossible");
    }
  }

  async function decideKyc(id: string, status: "passed" | "failed" | "verifying") {
    try {
      await reviewKyc({ data: { id, status } });
      toast.success("Contrôle KYC mis à jour");
      await load();
    } catch {
      toast.error("Action impossible");
    }
  }


  async function copyPortalLink() {
    try {
      const { token } = await issueLink({ data: { id: applicationId } });
      const url = `${window.location.origin}/secure/application/${token}`;
      await navigator.clipboard.writeText(url);
      toast.success("Lien sécurisé copié");
    } catch {
      toast.error("Génération impossible");
    }
  }

  if (loading) return <CenterLoader />;
  if (!data) {
    return (
      <Card>
        <CardContent className="py-14 text-center text-sm text-muted-foreground">Dossier introuvable.</CardContent>
      </Card>
    );
  }

  const a = data.application;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <Link
            to="/admin/applications"
            search={{ status: undefined, q: undefined }}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Retour aux dossiers
          </Link>
          <h1 className="mt-1 font-serif text-2xl font-semibold tracking-tight">{a.reference}</h1>
          <p className="text-sm text-muted-foreground">
            {[a.first_name, a.last_name].filter(Boolean).join(" ")} · {a.email}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={a.status} />
          <Button variant="outline" size="sm" onClick={copyPortalLink}>
            <Copy className="mr-1.5 h-4 w-4" /> Lien client
          </Button>
        </div>
      </div>

      <Tabs defaultValue="dossier" className="space-y-5">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="dossier">Informations & décision</TabsTrigger>
          <TabsTrigger value="analyse">Analyse & KYC</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="finance">Contrat, paiements & décaissement</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>

        <TabsContent value="dossier" className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Informations du demandeur</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Téléphone" value={a.phone} />
            <Field label="Date de naissance" value={a.birth_date} />
            <Field label="Nationalité" value={a.nationality} />
            <Field label="Adresse" value={[a.address, a.postal_code, a.city, a.country].filter(Boolean).join(", ")} />
            <Field label="Situation pro." value={a.employment_status} />
            <Field label="Profession" value={a.profession} />
            <Field label="Employeur" value={a.employer} />
            <Field label="Ancienneté" value={a.seniority_months ? `${a.seniority_months} mois` : null} />
            <Field label="Revenus mensuels" value={money(a.monthly_income)} />
            <Field label="Charges mensuelles" value={money(a.monthly_charges)} />
            <Field label="Montant demandé" value={money(a.amount)} />
            <Field label="Durée" value={a.duration_months ? `${a.duration_months} mois` : null} />
            <Field label="Objet" value={a.purpose} />
            <Field label="Assurance" value={a.insurance_opted ? "Oui" : "Non"} />
            <Field label="Bénéficiaire" value={a.bank_holder} />
            <Field label="IBAN" value={a.bank_iban} />
            <Field label="BIC" value={a.bank_bic} />
            <Field label="Banque" value={a.bank_name} />
          </CardContent>
        </Card>

        <Card className="border-primary/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Décision & workflow</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Statut actuel</p>
              <p className="text-sm font-semibold">{statusLabel(a.status)}</p>
            </div>

            {transitions.length === 0 ? (
              <p className="text-xs text-muted-foreground">Statut terminal : aucune action possible.</p>
            ) : (
              <>
                {primary && (
                  <div>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Action recommandée
                    </p>
                    <Button
                      className="w-full justify-center"
                      disabled={busy || !primary.check.ok}
                      onClick={() => setPending(primary.status)}
                    >
                      {statusLabel(primary.status)}
                    </Button>
                    {!primary.check.ok && primary.check.reason && (
                      <p className="mt-1.5 text-xs text-amber-600">
                        {t(primary.check.reason, { defaultValue: primary.check.reason })}
                      </p>
                    )}
                  </div>
                )}

                {decisions.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Décisions formelles
                    </p>
                    <div className="grid gap-2">
                      {decisions.map(({ status: s, check }) => (
                        <div key={s}>
                          <Button
                            size="sm"
                            variant={s === "approved" ? "default" : "outline"}
                            className={`w-full justify-center ${s === "rejected" ? "border-destructive/50 text-destructive hover:bg-destructive/10" : ""}`}
                            disabled={busy || !check.ok}
                            onClick={() => setPending(s)}
                          >
                            {statusLabel(s)}
                          </Button>
                          {!check.ok && check.reason && (
                            <p className="mt-1 text-[11px] text-amber-600">
                              {t(check.reason, { defaultValue: check.reason })}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {!decisions.some((d) => d.status === "approved") && !isFinalised && (
                  <p className="rounded-lg border border-border bg-muted/40 p-3 text-[11px] leading-relaxed text-muted-foreground">
                    L'accord définitif se prononce depuis l'étape « {statusLabel("analysis")} ». Faites d'abord
                    progresser le dossier jusqu'à cette étape pour voir apparaître « {statusLabel("approved")} ».
                  </p>
                )}

                {secondary.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Autres étapes
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {secondary.map(({ status: s, check }) => (
                        <Button
                          key={s}
                          size="sm"
                          variant="outline"
                          disabled={busy || !check.ok}
                          title={check.ok ? undefined : t(check.reason ?? "", { defaultValue: check.reason ?? "" })}
                          onClick={() => setPending(s)}
                          className="text-xs"
                        >
                          {statusLabel(s)}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {blockers.length > 0 && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                  Conditions à lever
                </p>
                <ul className="mt-1.5 list-inside list-disc text-xs text-amber-700">
                  {blockers.map((b) => (
                    <li key={b}>{t(b, { defaultValue: b })}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>


        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">{t("workflow.requests.title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <select
                value={reqKind}
                onChange={(e) => setReqKind(e.target.value as InfoRequestKind)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                {INFO_REQUEST_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`workflow.requests.kinds.${k}`, { defaultValue: k })}
                  </option>
                ))}
              </select>
              <Input
                value={reqSlug}
                onChange={(e) => setReqSlug(e.target.value)}
                placeholder="Type de document (optionnel)"
              />
            </div>
            <Textarea
              value={reqMessage}
              onChange={(e) => setReqMessage(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="Message adressé au demandeur"
            />
            <Button size="sm" disabled={busy || reqMessage.trim().length < 3} onClick={() => void submitInfoRequest()}>
              {t("workflow.requests.create")}
            </Button>

            <ul className="space-y-2">
              {(data.infoRequests ?? []).map((r) => (
                <li key={r.id} className="rounded-lg border border-border p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">
                      {t(`workflow.requests.kinds.${r.kind}`, { defaultValue: r.kind })}
                      {r.document_type_slug ? ` · ${r.document_type_slug}` : ""}
                    </span>
                    <span className="text-muted-foreground">
                      {t(`workflow.requests.${r.status}`, { defaultValue: r.status })}
                    </span>
                  </div>
                  <p className="mt-1 text-muted-foreground">{r.message}</p>
                  {r.response_text && (
                    <p className="mt-2 rounded-md bg-muted p-2">
                      <span className="font-medium">Réponse : </span>
                      {r.response_text}
                    </p>
                  )}
                  {r.status === "open" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-1 h-7 px-2 text-xs"
                      disabled={busy}
                      onClick={async () => {
                        await closeInfoRequest({ data: { id: r.id } });
                        await load();
                      }}
                    >
                      Clôturer
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

      </div>

      <AlertDialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("workflow.confirmTitle", { defaultValue: "Confirmer le changement de statut" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {statusLabel(a.status)} → {pending ? statusLabel(pending) : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder={
                pending && REASON_REQUIRED.includes(pending)
                  ? "Motif communiqué au client (obligatoire)"
                  : "Motif communiqué au client (optionnel)"
              }
            />
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={1000}
              placeholder="Note interne"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t("workflow.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void confirmTransition();
              }}
            >
              Confirmer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Note interne</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Textarea
            value={internalNote}
            onChange={(e) => setInternalNote(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Visible uniquement par l'équipe (piste d'audit)"
          />
          <Button
            size="sm"
            disabled={busy || internalNote.trim().length < 2}
            onClick={() => void saveInternalNote()}
          >
            Enregistrer la note
          </Button>
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="analyse" className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Analyse financière</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Mensualité" value={a.monthly_payment ? money(a.monthly_payment) : null} />
            <Field label="Assurance / mois" value={a.insurance_monthly ? money(a.insurance_monthly) : null} />
            <Field label="TAEG" value={a.apr != null ? `${Number(a.apr).toFixed(2)} %` : null} />
            <Field label="Frais de dossier" value={a.fees != null ? money(a.fees) : null} />
            <Field label="Coût total du crédit" value={a.total_cost != null ? money(a.total_cost) : null} />
            <Field
              label="Taux d'endettement"
              value={a.dti_percent != null ? `${Number(a.dti_percent).toFixed(1)} %` : null}
            />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between gap-2 pb-3">
            <CardTitle className="text-sm font-semibold">Vérification KYC</CardTitle>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                a.kyc_status === "passed"
                  ? "bg-emerald-500/10 text-emerald-600"
                  : a.kyc_status === "failed"
                    ? "bg-destructive/10 text-destructive"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {a.kyc_status ?? "pending"}
            </span>
          </CardHeader>
          <CardContent className="space-y-2">
            {(data.kycChecks ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun contrôle enregistré.</p>
            ) : (
              (data.kycChecks ?? []).map((c) => (
                <div
                  key={c.id}
                  className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{c.step_key}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.category}
                      {c.document_type_slug ? ` · ${c.document_type_slug}` : ""} · {c.status}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button size="sm" variant="outline" className="text-xs" onClick={() => decideKyc(c.id, "passed")}>
                      Valider
                    </Button>
                    <Button size="sm" variant="outline" className="text-xs" onClick={() => decideKyc(c.id, "verifying")}>
                      À revoir
                    </Button>
                    <Button size="sm" variant="outline" className="text-xs" onClick={() => decideKyc(c.id, "failed")}>
                      Rejeter
                    </Button>
                  </div>
                </div>
              ))
            )}
            {Array.isArray(a.compliance_flags) &&
  a.compliance_flags.length > 0 && (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-700">
      <p className="font-semibold">Points de vigilance conformité</p>

      <ul className="mt-1 list-inside list-disc">
        {a.compliance_flags.map((f, index) => {
          if (!f || typeof f !== "object" || Array.isArray(f)) {
            return null;
          }

          const flag = f as {
            code?: string;
            field?: string;
            severity?: string;
          };

          return (
            <li key={`${flag.code ?? "flag"}-${index}`}>
              <span className="font-medium">
                {flag.code ?? "Vigilance conformité"}
              </span>

              {flag.field && (
                <span className="text-muted-foreground">
                  {" · champ : "}
                  {flag.field}
                </span>
              )}

              {flag.severity && (
                <span className="text-muted-foreground">
                  {" · "}
                  {flag.severity}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  )}
          </CardContent>
        </Card>
      </div>
        </TabsContent>

        <TabsContent value="documents" className="space-y-5">
      <div className="grid gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Pièces justificatives</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.documents.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune pièce transmise.</p>
            ) : (
              data.documents.map((d) => (
                <div key={d.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        <FileText className="mr-1.5 inline h-3.5 w-3.5" />
                        {d.file_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {d.document_type_slug} · {d.status}
                      </p>
                    </div>
                    {d.url && (
                      <a
                        href={d.url}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 text-xs font-medium text-primary hover:underline"
                      >
                        Ouvrir <ExternalLink className="inline h-3 w-3" />
                      </a>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" className="text-xs" onClick={() => review(d.id, "approved")}>
                      Valider
                    </Button>
                    <Button size="sm" variant="outline" className="text-xs" onClick={() => review(d.id, "replacement_requested")}>
                      Demander un remplacement
                    </Button>
                    <Button size="sm" variant="outline" className="text-xs" onClick={() => review(d.id, "rejected")}>
                      Refuser
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
        </TabsContent>

        <TabsContent value="finance" className="space-y-5">
          <AdminFinancePanel applicationId={applicationId} onChanged={() => void load()} />
        </TabsContent>

        <TabsContent value="audit" className="space-y-5">
      <div className="grid gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Historique</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3">
              {data.history.map((h) => (
                <li key={h.id} className="flex gap-3">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{statusLabel(h.new_status)}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(h.created_at).toLocaleString("fr-FR")} · {h.actor}
                    </p>
                    {h.note && <p className="mt-0.5 text-xs text-muted-foreground">{h.note}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

