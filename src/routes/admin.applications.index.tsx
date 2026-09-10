import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { CenterLoader } from "@/components/ui/loader";
import { EmptyState, ListCard, PageHeader } from "@/components/admin/AdminUI";
import { FileText } from "lucide-react";
import { APPLICATION_STATUS_ORDER, statusLabel } from "@/lib/application-status";
import { adminListApplications } from "@/lib/admin-applications.functions";

export const Route = createFileRoute("/admin/applications/")({
  validateSearch: (search: Record<string, unknown>) => ({
    status: typeof search.status === "string" ? search.status.slice(0, 40) : undefined,
    q: typeof search.q === "string" ? search.q.slice(0, 120) : undefined,
  }),
  component: ApplicationsList,
});

type Row = Awaited<ReturnType<typeof adminListApplications>>[number];

function money(n: number) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
}

function ApplicationsList() {
  const { status, q } = Route.useSearch();
  const navigate = useNavigate();
  const list = useServerFn(adminListApplications);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [term, setTerm] = useState(q ?? "");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await list({ data: { status: status as never, search: q, limit: 200 } });
      setRows(data);
    } finally {
      setLoading(false);
    }
  }, [list, status, q]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dossiers de financement"
        subtitle="Instruction, décision et suivi des demandes clients."
        actions={<span className="text-xs text-muted-foreground tabular-nums">{rows.length} dossier(s)</span>}
      />

      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          navigate({ to: "/admin/applications", search: { status, q: term || undefined } });
        }}
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Référence, nom ou email…"
            className="h-11 pl-9"
          />
        </div>
        <Button type="submit" className="h-11 sm:w-32">
          Rechercher
        </Button>
      </form>

      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        <Link
          to="/admin/applications"
          search={{ status: undefined, q }}
          className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
            !status ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"
          }`}
        >
          Tous
        </Link>
        {APPLICATION_STATUS_ORDER.map((s) => (
          <Link
            key={s}
            to="/admin/applications"
            search={{ status: s, q }}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              status === s ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"
            }`}
          >
            {statusLabel(s)}
          </Link>
        ))}
      </div>

      {loading ? (
        <CenterLoader />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Aucun dossier trouvé"
          description="Modifiez le filtre de statut ou la recherche pour élargir les résultats."
        />
      ) : (
        <ListCard>
            {rows.map((r) => (
                <li key={r.id}>
                  <Link
                    to="/admin/applications/$applicationId"
                    params={{ applicationId: r.id }}
                    className="flex flex-col gap-2 px-4 py-3.5 transition-colors hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between sm:px-6"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">
                        {r.reference} · {[r.first_name, r.last_name].filter(Boolean).join(" ") || r.email}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {money(Number(r.amount ?? 0))} · {r.duration_months ?? "—"} mois · {r.city ?? ""} {r.country ?? ""} ·{" "}
                        {new Date(r.created_at).toLocaleDateString("fr-FR")}
                      </p>
                    </div>
                    <StatusBadge status={r.status} />
                  </Link>
                </li>
            ))}
        </ListCard>
      )}
    </div>
  );
}
