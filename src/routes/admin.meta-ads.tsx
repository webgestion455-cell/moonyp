import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useTransition } from "react";
import {
  getMetaAdsStatus,
  getMetaAdsReport,
  syncMetaAdsNow,
  updateMetaAdsSettings,
} from "@/lib/meta-ads.functions";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  Layers,
  Megaphone,
  MousePointerClick,
  Percent,
  RefreshCw,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/meta-ads")({
  component: MetaAdsPage,
});

type Preset = "today" | "last_7d" | "last_30d" | "this_month";

function fmt(n: number | null | undefined, unit = "") {
  if (n === null || n === undefined) return "—";
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(n)}${unit}`;
}

function fmtMoney(n: number | null | undefined, currency = "EUR") {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(n);
}

function MetaAdsPage() {
  const { isSuperAdmin } = useAuth() as any;
  const [status, setStatus] = useState<Awaited<ReturnType<typeof getMetaAdsStatus>> | null>(null);
  const [report, setReport] = useState<Awaited<ReturnType<typeof getMetaAdsReport>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [preset, setPreset] = useState<Preset>("last_7d");
  const [selectedAccountId, setSelectedAccountId] = useState<string>("all");
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("all");

  const loadData = async () => {
    setLoading(true);
    try {
      const s = await getMetaAdsStatus();
      setStatus(s);

      const r = await getMetaAdsReport({
        data: {
          preset,
          account_id: selectedAccountId === "all" ? undefined : selectedAccountId,
          campaign_id: selectedCampaignId === "all" ? undefined : selectedCampaignId,
        },
      });
      setReport(r);
    } catch (err: any) {
      toast.error("Erreur de chargement Meta Ads : " + (err?.message || "Accès refusé"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [preset, selectedAccountId, selectedCampaignId]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await syncMetaAdsNow({ data: { mode: "manual" } });
      if (res.status === "success") {
        toast.success("Synchronisation Meta Ads réussie !");
      } else if (res.status === "partial") {
        toast.warning("Synchronisation partielle, vérifiez les journaux.");
      } else {
        toast.error("Erreur lors de la synchronisation Meta.");
      }
      await loadData();
    } catch (e: any) {
      toast.error(e?.message || "Échec de synchronisation");
    } finally {
      setSyncing(false);
    }
  };

  const handleToggleSpend = async (show: boolean) => {
    startTransition(async () => {
      try {
        await updateMetaAdsSettings({ data: { show_spend: show } });
        toast.success(show ? "Affichage des dépenses activé" : "Dépenses masquées");
        await loadData();
      } catch (e: any) {
        toast.error("Impossible de modifier les paramètres");
      }
    });
  };

  const isConfigured = status?.configured;
  const missingSecrets = status?.missing_secrets ?? [];
  const summary = report?.summary?.metrics;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Megaphone className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">Meta Ads — Reporting</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Statistiques officielles Facebook & Instagram synchronisées en lecture seule.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {status?.last_success_at && (
            <span className="text-xs text-muted-foreground hidden md:inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              Dernière synchro : {new Date(status.last_success_at).toLocaleTimeString("fr-FR")}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleSync}
            disabled={syncing || !isConfigured}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Synchronisation..." : "Synchroniser"}
          </Button>
        </div>
      </div>

      {/* Alerte si clés manquantes */}
      {!isConfigured && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
              <AlertCircle className="h-5 w-5" />
              <CardTitle className="text-base font-medium">Configuration Meta requise</CardTitle>
            </div>
            <CardDescription className="text-xs">
              Les variables suivantes doivent être renseignées dans les paramètres de votre projet pour activer l'API Meta :{" "}
              <strong>{missingSecrets.join(", ")}</strong>.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* Barre de filtres */}
      <div className="flex flex-wrap items-center gap-3 bg-muted/30 p-3 rounded-lg border">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Période :</span>
          <Select value={preset} onValueChange={(v) => setPreset(v as Preset)}>
            <SelectTrigger className="w-[140px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Aujourd'hui</SelectItem>
              <SelectItem value="last_7d">7 derniers jours</SelectItem>
              <SelectItem value="last_30d">30 derniers jours</SelectItem>
              <SelectItem value="this_month">Ce mois-ci</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {status?.accounts && status.accounts.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Compte :</span>
            <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
              <SelectTrigger className="w-[180px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les comptes</SelectItem>
                {status.accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name || a.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {report?.campaigns && report.campaigns.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Campagne :</span>
            <Select value={selectedCampaignId} onValueChange={setSelectedCampaignId}>
              <SelectTrigger className="w-[200px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes les campagnes</SelectItem>
                {report.campaigns.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name || c.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {isSuperAdmin && (
          <div className="ml-auto flex items-center gap-2 pl-4 border-l">
            {report?.show_spend ? (
              <Eye className="h-4 w-4 text-primary" />
            ) : (
              <EyeOff className="h-4 w-4 text-muted-foreground" />
            )}
            <Label htmlFor="spend-toggle" className="text-xs cursor-pointer">
              Afficher dépenses
            </Label>
            <Switch
              id="spend-toggle"
              checked={report?.show_spend ?? false}
              onCheckedChange={handleToggleSpend}
              disabled={isPending}
            />
          </div>
        )}
      </div>

      {/* Cartes KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-muted-foreground" /> Impressions
            </CardDescription>
            <CardTitle className="text-2xl font-bold">{fmt(summary?.impressions)}</CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs flex items-center gap-1.5">
              <MousePointerClick className="h-3.5 w-3.5 text-muted-foreground" /> Clics sur lien
            </CardDescription>
            <CardTitle className="text-2xl font-bold">
              {fmt(summary?.inline_link_clicks ?? summary?.clicks)}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs flex items-center gap-1.5">
              <Percent className="h-3.5 w-3.5 text-muted-foreground" /> Taux de clic (CTR)
            </CardDescription>
            <CardTitle className="text-2xl font-bold">{fmt(summary?.ctr, "%")}</CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs flex items-center gap-1.5">
              {report?.show_spend ? (
                <>Dépenses totales</>
              ) : (
                <><Sparkles className="h-3.5 w-3.5 text-muted-foreground" /> Conversions</>
              )}
            </CardDescription>
            <CardTitle className="text-2xl font-bold">
              {report?.show_spend
                ? fmtMoney(summary?.spend)
                : fmt(summary?.conversions)}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Graphique de tendance */}
      {report?.series && report.series.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Évolution quotidienne</CardTitle>
            <CardDescription className="text-xs">Impressions et clics sur la période</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={report.series} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorImp" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorClicks" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="impressions"
                    name="Impressions"
                    stroke="#3b82f6"
                    fillOpacity={1}
                    fill="url(#colorImp)"
                  />
                  <Area
                    yAxisId="right"
                    type="monotone"
                    dataKey="clicks"
                    name="Clics"
                    stroke="#10b981"
                    fillOpacity={1}
                    fill="url(#colorClicks)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tableaux détaillés */}
      <Tabs defaultValue="campaigns" className="w-full">
        <TabsList>
          <TabsTrigger value="campaigns">Campagnes ({report?.levels.campaign.length ?? 0})</TabsTrigger>
          <TabsTrigger value="adsets">Ensembles de pubs ({report?.levels.adset.length ?? 0})</TabsTrigger>
          <TabsTrigger value="ads">Publicités ({report?.levels.ad.length ?? 0})</TabsTrigger>
          {isSuperAdmin && <TabsTrigger value="config">Diagnostic & Clés</TabsTrigger>}
        </TabsList>

        {/* Campagnes */}
        <TabsContent value="campaigns" className="mt-4">
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Statut</TableHead>
                  <TableHead>Nom</TableHead>
                  <TableHead>Objectif</TableHead>
                  <TableHead className="text-right">Impressions</TableHead>
                  <TableHead className="text-right">Clics</TableHead>
                  <TableHead className="text-right">CTR</TableHead>
                  {report?.show_spend && <TableHead className="text-right">Dépenses</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {report?.levels.campaign.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-6 text-muted-foreground text-sm">
                      Aucune campagne synchronisée pour cette période.
                    </TableCell>
                  </TableRow>
                ) : (
                  report?.levels.campaign.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <Badge variant={row.status === "ACTIVE" ? "default" : "secondary"}>
                          {row.status || "—"}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium max-w-[240px] truncate">{row.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{row.objective || "—"}</TableCell>
                      <TableCell className="text-right">{fmt(row.metrics.impressions)}</TableCell>
                      <TableCell className="text-right">{fmt(row.metrics.clicks)}</TableCell>
                      <TableCell className="text-right">{fmt(row.metrics.ctr, "%")}</TableCell>
                      {report?.show_spend && (
                        <TableCell className="text-right font-medium">{fmtMoney(row.metrics.spend)}</TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        {/* Ensembles de publicités */}
        <TabsContent value="adsets" className="mt-4">
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Statut</TableHead>
                  <TableHead>Nom de l'ensemble</TableHead>
                  <TableHead className="text-right">Impressions</TableHead>
                  <TableHead className="text-right">Clics</TableHead>
                  <TableHead className="text-right">CTR</TableHead>
                  {report?.show_spend && <TableHead className="text-right">Dépenses</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {report?.levels.adset.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-6 text-muted-foreground text-sm">
                      Aucun ensemble de publicités trouvé.
                    </TableCell>
                  </TableRow>
                ) : (
                  report?.levels.adset.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <Badge variant={row.status === "ACTIVE" ? "default" : "secondary"}>
                          {row.status || "—"}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium max-w-[240px] truncate">{row.name}</TableCell>
                      <TableCell className="text-right">{fmt(row.metrics.impressions)}</TableCell>
                      <TableCell className="text-right">{fmt(row.metrics.clicks)}</TableCell>
                      <TableCell className="text-right">{fmt(row.metrics.ctr, "%")}</TableCell>
                      {report?.show_spend && (
                        <TableCell className="text-right font-medium">{fmtMoney(row.metrics.spend)}</TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        {/* Publicités */}
        <TabsContent value="ads" className="mt-4">
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Statut</TableHead>
                  <TableHead>Nom de l'annonce</TableHead>
                  <TableHead className="text-right">Impressions</TableHead>
                  <TableHead className="text-right">Clics</TableHead>
                  <TableHead className="text-right">CTR</TableHead>
                  {report?.show_spend && <TableHead className="text-right">Dépenses</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {report?.levels.ad.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-6 text-muted-foreground text-sm">
                      Aucune publicité trouvée.
                    </TableCell>
                  </TableRow>
                ) : (
                  report?.levels.ad.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <Badge variant={row.status === "ACTIVE" ? "default" : "secondary"}>
                          {row.status || "—"}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium max-w-[240px] truncate">{row.name}</TableCell>
                      <TableCell className="text-right">{fmt(row.metrics.impressions)}</TableCell>
                      <TableCell className="text-right">{fmt(row.metrics.clicks)}</TableCell>
                      <TableCell className="text-right">{fmt(row.metrics.ctr, "%")}</TableCell>
                      {report?.show_spend && (
                        <TableCell className="text-right font-medium">{fmtMoney(row.metrics.spend)}</TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        {/* Diagnostic (SuperAdmin) */}
        {isSuperAdmin && (
          <TabsContent value="config" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Diagnostic du jeton Meta</CardTitle>
                <CardDescription className="text-xs">
                  Vérification de validité et des permissions accordées au jeton API Meta.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {status?.token ? (
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">Validité : </span>
                      {status.token.is_valid ? (
                        <Badge className="bg-emerald-500">Valide</Badge>
                      ) : (
                        <Badge variant="destructive">Invalide</Badge>
                      )}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Permission requise (ads_read) : </span>
                      {status.token.has_ads_read ? (
                        <Badge className="bg-emerald-500">Présente</Badge>
                      ) : (
                        <Badge variant="destructive">Manquante</Badge>
                      )}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Type de jeton : </span>
                      <span className="font-mono">{status.token.type || "Système / Inconnu"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Expiration : </span>
                      <span>
                        {status.token.expires_at
                          ? new Date(status.token.expires_at).toLocaleDateString("fr-FR")
                          : "Permanent (Never)"}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Aucun jeton actif vérifiable. Veuillez configurer les variables Meta.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Dernières exécutions de synchronisation</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Déclencheur</TableHead>
                      <TableHead>Statut</TableHead>
                      <TableHead>Heure début</TableHead>
                      <TableHead>Détails / Erreurs</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {status?.runs.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="capitalize">{r.trigger}</TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              r.status === "success"
                                ? "default"
                                : r.status === "error"
                                  ? "destructive"
                                  : "secondary"
                            }
                          >
                            {r.status}
                          </Badge>
                        </TableCell>
                        <TableCell>{new Date(r.started_at).toLocaleString("fr-FR")}</TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[300px] truncate">
                          {r.error_message || JSON.stringify(r.stats)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
