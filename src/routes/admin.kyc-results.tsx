import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, FileText, FolderSearch } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CenterLoader } from "@/components/ui/loader";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import { adminGetKycRequestDetail, adminListKycRequests } from "@/lib/kyc-requests.functions";
import { SuperAdminOnly } from "@/routes/admin.kyc-requests";

export const Route = createFileRoute("/admin/kyc-results")({
  head: () => ({ meta: [{ title: "Dossiers de vérification externes — Administration" }] }),
  component: AdminKycResults,
});

type ListRow = Awaited<ReturnType<typeof adminListKycRequests>>[number];
type Detail = Awaited<ReturnType<typeof adminGetKycRequestDetail>>;

const STATUS_LABEL: Record<string, string> = {
  pending: "En attente",
  in_progress: "En cours",
  completed: "Terminée",
  revoked: "Révoquée",
  expired: "Expirée",
};

const DECISION_LABEL: Record<string, string> = {
  passed: "Validé",
  manual_review: "Revue manuelle",
  failed: "Refusé",
};

const fmt = (v?: string | null) => (v ? new Date(v).toLocaleString("fr-FR") : "—");

function AdminKycResults() {
  const { isSuperAdmin, loading } = useAuth();
  if (loading) return <CenterLoader />;
  if (!isSuperAdmin) return <SuperAdminOnly />;
  return <Inner />;
}

function Inner() {
  const list = useServerFn(adminListKycRequests);
  const detail = useServerFn(adminGetKycRequestDetail);
  const [rows, setRows] = useState<ListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [data, setData] = useState<Detail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    list({ data: undefined as never })
      .then((r) => setRows(r.filter((x) => x.effective_status !== "pending")))
      .catch(() => toast.error("Chargement impossible"))
      .finally(() => setLoading(false));
  }, [list]);

  const open = useCallback(
    async (id: string) => {
      setSelected(id);
      setLoadingDetail(true);
      setData(null);
      try {
        setData(await detail({ data: { id } }));
      } catch {
        toast.error("Dossier indisponible");
      } finally {
        setLoadingDetail(false);
      }
    },
    [detail],
  );

  if (loading) return <CenterLoader />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-serif text-2xl font-semibold tracking-tight sm:text-3xl">
          Dossiers externes
        </h1>
        <p className="text-sm text-muted-foreground">
          Informations et documents transmis via les liens de vérification d'identité.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_1fr]">
        <Card>
          <CardContent className="p-0">
            {rows.length === 0 ? (
              <div className="grid place-items-center gap-2 py-16 text-center text-sm text-muted-foreground">
                <FolderSearch className="h-6 w-6" />
                Aucun dossier transmis pour le moment.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {rows.map((r) => (
                  <li key={r.id}>
                    <button
                      onClick={() => void open(r.id)}
                      className={cn(
                        "w-full text-left px-4 py-3 hover:bg-muted transition",
                        selected === r.id && "bg-muted",
                      )}
                    >
                      <p className="font-medium text-sm">{r.full_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.reference} · {STATUS_LABEL[r.effective_status] ?? r.effective_status}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 sm:p-6">
            {!selected ? (
              <p className="text-sm text-muted-foreground">Sélectionnez un dossier.</p>
            ) : loadingDetail || !data ? (
              <CenterLoader />
            ) : (
              <DetailView d={data} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Section({ title, value }: { title: string; value: unknown }) {
  if (!value || typeof value !== "object") return null;
  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([, v]) => v !== null && v !== "" && typeof v !== "object",
  );
  if (!entries.length) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2 text-sm">
        {entries.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 border-b border-border/60 py-1">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="text-right break-all">{String(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function DetailView({ d }: { d: Detail }) {
  const collected = (d.collected ?? {}) as Record<string, unknown>;
  const reasons = Array.isArray(d.kyc_reasons) ? (d.kyc_reasons as string[]) : [];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{d.full_name}</p>
          <p className="text-xs text-muted-foreground">
            {d.reference} · {d.email}
            {d.phone ? ` · ${d.phone}` : ""} · {d.language?.toUpperCase()}
          </p>
        </div>
        <div className="flex gap-2">
          <Badge variant="outline">{STATUS_LABEL[d.effective_status] ?? d.effective_status}</Badge>
          {d.kyc_decision && (
            <Badge>{DECISION_LABEL[d.kyc_decision as string] ?? d.kyc_decision}</Badge>
          )}
        </div>
      </div>

      <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
        <span>Créée : {fmt(d.created_at)}</span>
        <span>Dernier accès : {fmt(d.last_accessed_at)}</span>
        <span>Finalisée : {fmt(d.completed_at)}</span>
        <span>Expiration : {fmt(d.expires_at)}</span>
        {d.kyc_score !== null && d.kyc_score !== undefined && <span>Score : {d.kyc_score}</span>}
      </div>

      {d.partner_note && <p className="text-sm">Note : {d.partner_note}</p>}

      <Section title="Identité" value={collected.identity} />
      <Section title="Situation professionnelle" value={collected.employment} />
      <Section title="Coordonnées de versement" value={collected.payout} />
      <Section title="Informations" value={collected} />

      {reasons.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Motifs d'analyse</h3>
          <div className="flex flex-wrap gap-1.5">
            {reasons.map((r) => (
              <Badge key={r} variant="secondary" className="font-mono text-[10px]">
                {r}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Documents ({d.documents.length})</h3>
        {d.documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun document.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {d.documents.map((doc) => {
              const x = doc as unknown as {
                id: string;
                document_type_slug: string;
                file_name: string | null;
                status: string | null;
                capture_method: string | null;
                url: string | null;
              };
              return (
                <li key={x.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{x.document_type_slug}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {x.file_name ?? "—"} · {x.capture_method ?? "—"} · {x.status ?? "—"}
                    </p>
                  </div>
                  {x.url && (
                    <a
                      href={x.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    >
                      Ouvrir <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
