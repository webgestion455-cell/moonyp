import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, RotateCcw, ScanFace, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CenterLoader } from "@/components/ui/loader";
import { adminKycCounters, adminKycQueue } from "@/lib/admin-catalog.functions";
import { adminReviewKycCheck } from "@/lib/admin-applications.functions";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/kyc")({
  component: AdminKycQueue,
});

type Row = Awaited<ReturnType<typeof adminKycQueue>>[number];
type Counters = Awaited<ReturnType<typeof adminKycCounters>>;

/*
 * Tous les états sont exposés : la file « à vérifier » peut être vide alors
 * que le dossier porte des contrôles déjà validés ou rejetés. L'onglet
 * « Tous » est le point d'entrée par défaut pour que la section montre
 * toujours la réalité de la base.
 */
const FILTERS = ["all", "verifying", "todo", "failed", "passed"] as const;
type Filter = (typeof FILTERS)[number];

const FILTER_LABELS: Record<Filter, string> = {
  all: "Tous",
  verifying: "À vérifier",
  todo: "À déposer",
  failed: "Rejetés",
  passed: "Validés",
};

const STATUS_STYLES: Record<string, string> = {
  passed: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
  failed: "border-rose-500/30 bg-rose-500/10 text-rose-700",
  verifying: "border-amber-500/30 bg-amber-500/10 text-amber-700",
  todo: "border-border bg-muted text-muted-foreground",
};

const STATUS_LABELS: Record<string, string> = {
  passed: "Validé",
  failed: "Rejeté",
  verifying: "À vérifier",
  todo: "À déposer",
};

const EMPTY_COUNTERS: Counters = { all: 0, todo: 0, verifying: 0, passed: 0, failed: 0 };

function AdminKycQueue() {
  const list = useServerFn(adminKycQueue);
  const counters = useServerFn(adminKycCounters);
  const review = useServerFn(adminReviewKycCheck);

  const [filter, setFilter] = useState<Filter>("all");
  const [rows, setRows] = useState<Row[]>([]);
  const [counts, setCounts] = useState<Counters>(EMPTY_COUNTERS);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  /**
   * `silent` : rechargement d'arrière-plan (toutes les 5 s) qui n'affiche
   * jamais le loader, pour éviter tout clignotement de la liste.
   */
  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const [queue, stats] = await Promise.all([
          list({ data: { status: filter, limit: 200 } }),
          counters({ data: undefined as never }),
        ]);
        setRows(queue);
        setCounts(stats);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [list, counters, filter],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Actualisation silencieuse toutes les 5 secondes.
  useAutoRefresh(() => load(true));

  const decide = async (id: string, status: "passed" | "failed" | "verifying") => {
    setBusy(id);
    try {
      await review({ data: { id, status } });
      toast.success(
        status === "passed" ? "Contrôle validé" : status === "failed" ? "Contrôle rejeté" : "Contrôle remis à vérifier",
      );
      await load(true);
    } catch {
      toast.error("Action impossible");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-serif text-2xl font-semibold tracking-tight sm:text-3xl">Conformité — KYC</h1>
          <p className="text-sm text-muted-foreground">
            Contrôles d'identité de tous les dossiers, dans chacun de leurs états. Mise à jour automatique.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                filter === f ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted",
              )}
            >
              {FILTER_LABELS[f]}
              <span className="ml-1.5 tabular-nums opacity-80">{counts[f] ?? 0}</span>
            </button>
          ))}
        </div>
      </header>

      {/* Compteurs réels : la section reste informative même sans file active. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-xl border p-3 text-left transition-colors",
              filter === f ? "border-primary bg-primary/5" : "border-border hover:bg-muted/60",
            )}
          >
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{FILTER_LABELS[f]}</p>
            <p className="mt-0.5 text-xl font-semibold tabular-nums">{counts[f] ?? 0}</p>
          </button>
        ))}
      </div>

      {loading ? (
        <CenterLoader />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="grid place-items-center gap-2 py-16 text-center">
            <ScanFace className="h-8 w-8 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">
              {counts.all > 0
                ? `Aucun contrôle « ${FILTER_LABELS[filter]} ». ${counts.all} contrôle(s) existent dans les autres états.`
                : "Aucun contrôle d'identité enregistré pour l'instant."}
            </p>
            {counts.all > 0 && filter !== "all" && (
              <Button variant="outline" size="sm" className="rounded-full" onClick={() => setFilter("all")}>
                Voir tous les contrôles
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {rows.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-6"
                >
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 truncate text-sm font-semibold">
                      {r.application?.reference ?? "—"} ·{" "}
                      {[r.application?.first_name, r.application?.last_name].filter(Boolean).join(" ") ||
                        r.application?.email}
                      <Badge
                        variant="outline"
                        className={cn("shrink-0 text-[10px]", STATUS_STYLES[String(r.status)] ?? STATUS_STYLES.todo)}
                      >
                        {STATUS_LABELS[String(r.status)] ?? String(r.status)}
                      </Badge>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {r.category} · {r.document_type_slug ?? r.step_key} ·{" "}
                      {new Date(r.created_at).toLocaleString("fr-FR")}
                    </p>
                    {r.review_note && (
                      <p className="mt-1 truncate text-xs text-muted-foreground">Note : {r.review_note}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {r.application && (
                      <Button asChild variant="outline" size="sm" className="rounded-full">
                        <Link to="/admin/applications/$applicationId" params={{ applicationId: r.application_id }}>
                          Dossier
                        </Link>
                      </Button>
                    )}
                    {r.status !== "verifying" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="rounded-full"
                        disabled={busy === r.id}
                        onClick={() => void decide(r.id, "verifying")}
                      >
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                        À revoir
                      </Button>
                    )}
                    {r.status !== "failed" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-full"
                        disabled={busy === r.id}
                        onClick={() => void decide(r.id, "failed")}
                      >
                        <XCircle className="h-3.5 w-3.5" aria-hidden />
                        Rejeter
                      </Button>
                    )}
                    {r.status !== "passed" && (
                      <Button
                        size="sm"
                        className="rounded-full"
                        disabled={busy === r.id}
                        onClick={() => void decide(r.id, "passed")}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                        Valider
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
