import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowUpRight,
  Banknote,
  CheckCircle2,
  Clock,
  FileText,
  XCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { CenterLoader } from "@/components/ui/loader";
import { AdminAnalytics, type MonthPoint } from "@/components/admin/AdminAnalytics";
import { adminApplicationStats, adminListApplications } from "@/lib/admin-applications.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin/")({
  component: AdminOverview,
});

interface Stats {
  total: number;
  byStatus: Record<string, number>;
  months: MonthPoint[];
  pending: number;
  approved: number;
  rejected: number;
  disbursedCount: number;
  disbursedVolume: number;
  totalVolume: number;
}

type Row = Awaited<ReturnType<typeof adminListApplications>>[number];

function money(n: number) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
}

function AdminOverview() {
  const getStats = useServerFn(adminApplicationStats);
  const listApplications = useServerFn(adminListApplications);

  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([
        getStats({ data: undefined as never }),
        listApplications({ data: { limit: 8 } }),
      ]);
      setStats(s as Stats);
      setRecent(r);
    } finally {
      setLoading(false);
    }
  }, [getStats, listApplications]);

  useEffect(() => {
    void load();
  }, [load]);

  // Realtime refresh on any application change
  useEffect(() => {
    const channel = supabase
      .channel(`admin-overview-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "loan_applications" }, () => void load())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  const kpis = useMemo(
    () => [
      { label: "Dossiers totaux", value: String(stats?.total ?? 0), icon: FileText, tone: "text-sky-600" },
      { label: "En instruction", value: String(stats?.pending ?? 0), icon: Clock, tone: "text-amber-600" },
      { label: "Accordés", value: String(stats?.approved ?? 0), icon: CheckCircle2, tone: "text-emerald-600" },
      { label: "Refusés", value: String(stats?.rejected ?? 0), icon: XCircle, tone: "text-rose-600" },
      { label: "Montant débloqué", value: money(stats?.disbursedVolume ?? 0), icon: Banknote, tone: "text-emerald-600" },
      { label: "Volume demandé", value: money(stats?.totalVolume ?? 0), icon: ArrowUpRight, tone: "text-primary" },
    ],
    [stats],
  );

  if (loading) return <CenterLoader />;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-serif text-2xl font-semibold tracking-tight sm:text-3xl">Pilotage</h1>
          <p className="text-sm text-muted-foreground">Vue temps réel des demandes de financement MOONYP.</p>
        </div>
        <Button asChild size="sm" className="rounded-full">
          <Link to="/admin/applications" search={{ status: undefined, q: undefined }}>
            Tous les dossiers
            <ArrowUpRight className="ml-1.5 h-4 w-4" />
          </Link>
        </Button>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <Card key={k.label}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{k.label}</p>
                  <Icon className={`h-4 w-4 shrink-0 ${k.tone}`} />
                </div>
                <p className="mt-2 break-words font-serif text-xl font-semibold sm:text-2xl">{k.value}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <AdminAnalytics months={stats?.months ?? []} byStatus={stats?.byStatus ?? {}} />

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-sm font-semibold">Derniers dossiers</CardTitle>
          <Link
            to="/admin/applications"
            search={{ status: undefined, q: undefined }}
            className="text-xs font-medium text-primary hover:underline"
          >
            Voir tout
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {recent.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">Aucun dossier pour le moment.</p>
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((r) => (
                <li key={r.id}>
                  <Link
                    to="/admin/applications/$applicationId"
                    params={{ applicationId: r.id }}
                    className="flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between sm:px-6"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">
                        {r.reference} · {[r.first_name, r.last_name].filter(Boolean).join(" ") || r.email}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {money(Number(r.amount ?? 0))} · {r.duration_months ?? "—"} mois ·{" "}
                        {new Date(r.created_at).toLocaleDateString("fr-FR")}
                      </p>
                    </div>
                    <StatusBadge status={r.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
