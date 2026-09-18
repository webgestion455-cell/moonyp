import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowUpRight,
  Banknote,
  CheckCircle2,
  Clock,
  CreditCard,
  FileSignature,
  FileText,
  Landmark,
  Repeat,
  ScanFace,
  ShieldCheck,
  Wallet,
  XCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { CenterLoader } from "@/components/ui/loader";
import { AdminAnalytics, type MonthPoint } from "@/components/admin/AdminAnalytics";
import { PageHeader, SectionTitle, StatTile, type StatTone } from "@/components/admin/AdminUI";
import { adminApplicationStats, adminListApplications } from "@/lib/admin-applications.functions";
import { supabase } from "@/integrations/supabase/client";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";

export const Route = createFileRoute("/admin/")({
  component: AdminOverview,
});

type Stats = Awaited<ReturnType<typeof adminApplicationStats>> & { months: MonthPoint[] };

type Row = Awaited<ReturnType<typeof adminListApplications>>[number];

/** Traduit l'ancienne couleur d'icône en tonalité du système d'interface. */
function toneOf(tone: string): StatTone {
  if (tone.includes("emerald")) return "positive";
  if (tone.includes("amber") || tone.includes("orange")) return "warning";
  if (tone.includes("rose")) return "critical";
  if (tone.includes("primary")) return "primary";
  return "neutral";
}

function money(n: number) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}

function AdminOverview() {
  const getStats = useServerFn(adminApplicationStats);
  const listApplications = useServerFn(adminListApplications);

  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [s, r] = await Promise.allSettled([
        getStats({ data: undefined as never }),
        listApplications({ data: { limit: 8 } }),
      ]);
      // Un incident passager ne doit jamais vider un tableau de bord déjà affiché.
      if (s.status === "fulfilled") setStats(s.value as Stats);
      if (r.status === "fulfilled" && Array.isArray(r.value)) setRecent(r.value as Row[]);
    } finally {
      setLoading(false);
    }
  }, [getStats, listApplications]);

  useEffect(() => {
    void load();
  }, [load]);

  // Actualisation automatique toutes les 5 secondes (silencieuse).
  useAutoRefresh(load);

  // Realtime refresh on any application change
  useEffect(() => {
    const channel = supabase
      .channel(`admin-overview-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "loan_applications" },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  const groups = useMemo(
    () => [
      {
        title: "Instruction",
        items: [
          {
            label: "Dossiers totaux",
            value: String(stats?.total ?? 0),
            icon: FileText,
            tone: "text-sky-600",
          },
          {
            label: "Nouvelles demandes",
            value: String(stats?.newRequests ?? 0),
            icon: ArrowUpRight,
            tone: "text-sky-600",
          },
          {
            label: "En vérification",
            value: String(stats?.verification ?? 0),
            icon: ShieldCheck,
            tone: "text-amber-600",
          },
          {
            label: "En analyse",
            value: String(stats?.analysis ?? 0),
            icon: Clock,
            tone: "text-amber-600",
          },
          {
            label: "Documents manquants",
            value: String(stats?.documentsMissing ?? 0),
            icon: ScanFace,
            tone: "text-orange-600",
          },
          {
            label: "Infos demandées",
            value: String(stats?.infoRequested ?? 0),
            icon: AlertTriangle,
            tone: "text-orange-600",
          },
          {
            label: "Approuvés",
            value: String(stats?.approved ?? 0),
            icon: CheckCircle2,
            tone: "text-emerald-600",
          },
          {
            label: "Refusés",
            value: String(stats?.rejected ?? 0),
            icon: XCircle,
            tone: "text-rose-600",
          },
        ],
      },
      {
        title: "Contrats, garanties et assurances",
        items: [
          {
            label: "Contrats en attente",
            value: String(stats?.contractsPending ?? 0),
            icon: FileSignature,
            tone: "text-amber-600",
          },
          {
            label: "Contrats signés",
            value: String(stats?.contractsSigned ?? 0),
            icon: FileSignature,
            tone: "text-emerald-600",
          },
          {
            label: "Garanties en cours",
            value: String(stats?.guaranteesPending ?? 0),
            icon: ShieldCheck,
            tone: "text-amber-600",
          },
          {
            label: "Garanties validées",
            value: String(stats?.guaranteesValidated ?? 0),
            icon: ShieldCheck,
            tone: "text-emerald-600",
          },
          {
            label: "Assurances en attente",
            value: String(stats?.insurancesPending ?? 0),
            icon: ShieldCheck,
            tone: "text-amber-600",
          },
          {
            label: "Assurances validées",
            value: String(stats?.insurancesValidated ?? 0),
            icon: ShieldCheck,
            tone: "text-emerald-600",
          },
        ],
      },
      {
        title: "Paiements et décaissements",
        items: [
          {
            label: "Paiements en attente",
            value: String(stats?.paymentsPending ?? 0),
            icon: CreditCard,
            tone: "text-amber-600",
          },
          {
            label: "Paiements encaissés",
            value: money(stats?.paymentsPaidVolume ?? 0),
            icon: CreditCard,
            tone: "text-emerald-600",
          },
          {
            label: "Décaissements à préparer",
            value: String(stats?.disbursementsPreparing ?? 0),
            icon: Landmark,
            tone: "text-amber-600",
          },
          {
            label: "Montant décaissé",
            value: money(stats?.disbursedVolume ?? 0),
            icon: Banknote,
            tone: "text-emerald-600",
          },
          {
            label: "Volume demandé",
            value: money(stats?.totalVolume ?? 0),
            icon: ArrowUpRight,
            tone: "text-primary",
          },
          {
            label: "Volume approuvé",
            value: money(stats?.approvedVolume ?? 0),
            icon: CheckCircle2,
            tone: "text-primary",
          },
        ],
      },
      {
        title: "Portefeuille et remboursements",
        items: [
          {
            label: "Prêts actifs",
            value: String(stats?.activeLoans ?? 0),
            icon: Wallet,
            tone: "text-sky-600",
          },
          {
            label: "Prêts soldés",
            value: String(stats?.repaidLoans ?? 0),
            icon: CheckCircle2,
            tone: "text-emerald-600",
          },
          {
            label: "Dossiers en retard",
            value: String(stats?.lateLoans ?? 0),
            icon: AlertTriangle,
            tone: "text-rose-600",
          },
          {
            label: "Échéances en retard",
            value: String(stats?.installmentsLate ?? 0),
            icon: AlertTriangle,
            tone: "text-rose-600",
          },
          {
            label: "Échéances à venir",
            value: String(stats?.installmentsUpcoming ?? 0),
            icon: Repeat,
            tone: "text-sky-600",
          },
          {
            label: "Capital remboursé",
            value: money(stats?.repaidVolume ?? 0),
            icon: Banknote,
            tone: "text-emerald-600",
          },
          {
            label: "Encours restant",
            value: money(stats?.outstandingVolume ?? 0),
            icon: Wallet,
            tone: "text-primary",
          },
        ],
      },
    ],
    [stats],
  );

  if (loading) return <CenterLoader />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pilotage"
        subtitle="Vue temps réel des demandes de financement MOONYP."
        actions={
          <Button asChild size="sm" className="rounded-full">
            <Link to="/admin/applications" search={{ status: undefined, q: undefined }}>
              Tous les dossiers
              <ArrowUpRight className="ml-1.5 h-4 w-4" />
            </Link>
          </Button>
        }
      />

      {/* Bandeau prioritaire : ce qu'un responsable regarde en premier. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          size="lg"
          tone="primary"
          icon={FileText}
          label="Dossiers totaux"
          value={String(stats?.total ?? 0)}
          hint={`${stats?.newRequests ?? 0} nouvelle(s) demande(s)`}
        />
        <StatTile
          size="lg"
          tone="warning"
          icon={Clock}
          label="À traiter"
          value={String(
            (stats?.verification ?? 0) +
              (stats?.analysis ?? 0) +
              (stats?.documentsMissing ?? 0) +
              (stats?.infoRequested ?? 0),
          )}
          hint="Vérification, analyse, pièces et infos"
        />
        <StatTile
          size="lg"
          tone="positive"
          icon={Banknote}
          label="Montant décaissé"
          value={money(stats?.disbursedVolume ?? 0)}
          hint={`${stats?.activeLoans ?? 0} prêt(s) actif(s)`}
        />
        <StatTile
          size="lg"
          tone="critical"
          icon={AlertTriangle}
          label="Dossiers en retard"
          value={String(stats?.lateLoans ?? 0)}
          hint={`${stats?.installmentsLate ?? 0} échéance(s) en retard`}
        />
      </div>

      {groups.map((group) => (
        <section key={group.title} className="space-y-2.5">
          <SectionTitle>{group.title}</SectionTitle>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {group.items.map((k) => (
              <StatTile
                key={k.label}
                label={k.label}
                value={k.value}
                icon={k.icon}
                tone={toneOf(k.tone)}
              />
            ))}
          </div>
        </section>
      ))}

      <AdminAnalytics
        months={stats?.months ?? []}
        byStatus={stats?.byStatus ?? {}}
        byCountry={stats?.byCountry ?? {}}
        byProduct={stats?.byProduct ?? {}}
      />

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
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              Aucun dossier pour le moment.
            </p>
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
                        {r.reference} ·{" "}
                        {[r.first_name, r.last_name].filter(Boolean).join(" ") || r.email}
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
