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
import { APPLICATION_STATUS_ORDER, statusLabel } from "@/lib/application-status";
import {
  adminGetApplication,
  adminIssuePortalLink,
  adminReviewDocument,
  adminUpdateApplicationStatus,
} from "@/lib/admin-applications.functions";

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
  const issueLink = useServerFn(adminIssuePortalLink);

  const [data, setData] = useState<Detail>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await get({ data: { id: applicationId } });
    setData(res);
    setLoading(false);
  }, [get, applicationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function changeStatus(status: string) {
    if (busy) return;
    setBusy(true);
    try {
      await updateStatus({ data: { id: applicationId, status: status as never, note: note || undefined } });
      toast.success("Statut mis à jour");
      setNote("");
      await load();
    } catch {
      toast.error("Mise à jour impossible");
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

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Décision</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note interne / motif communiqué au client"
              rows={3}
              maxLength={1000}
            />
            <div className="flex flex-wrap gap-2">
              {APPLICATION_STATUS_ORDER.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={s === a.status ? "default" : "outline"}
                  disabled={busy}
                  onClick={() => changeStatus(s)}
                  className="text-xs"
                >
                  {statusLabel(s)}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
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
    </div>
  );
}
