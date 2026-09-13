import { createFileRoute, Link } from "@tanstack/react-router";
import { PageLoader } from "@/components/ui/loader";
import { useEffect, useState } from "react";
import { adminT, useAdminT } from "@/hooks/use-admin-t";
import { useAuth } from "@/lib/auth-context";
import { supabase as _sb } from "@/integrations/supabase/client";
const supabase: any = _sb;
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/admin/AdminUI";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShieldCheck, AlertTriangle, Activity, Smartphone, ArrowLeft, RefreshCw, Globe2, Search } from "lucide-react";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";

export const Route = createFileRoute("/admin/security")({
  component: AdminSecurity,
  head: () => ({ meta: [{ title: `${adminT("adminSec.metaTitle")} — MOONYP` }] }),
});

interface SecurityLog {
  id: string; user_id: string | null; action: string; ip_address: string | null;
  country: string | null; browser: string | null; os: string | null; success: boolean;
  device_fingerprint: string | null; created_at: string;
}
interface TrustedDevice {
  id: string; user_id: string; label: string | null; browser: string | null; os: string | null;
  country: string | null; trusted: boolean; last_seen_at: string;
}
interface Alert {
  id: string; user_id: string | null; alert_type: string; severity: string;
  description: string | null; resolved: boolean; created_at: string;
}
interface BehaviorRow {
  user_id: string; risk_score: number; session_count: number;
  total_session_seconds: number; sensitive_action_count: number; last_country: string | null;
}

function AdminSecurity() {
  const { user, role, loading: authLoading } = useAuth();
  const { t } = useAdminT();
  const [tab, setTab] = useState<"logs" | "devices" | "alerts" | "risk">("logs");
  const [logs, setLogs] = useState<SecurityLog[]>([]);
  const [devices, setDevices] = useState<TrustedDevice[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [behavior, setBehavior] = useState<BehaviorRow[]>([]);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const [l, d, a, b] = await Promise.all([
      supabase.from("security_logs").select("*").order("created_at", { ascending: false }).limit(500),
      supabase.from("trusted_devices").select("*").order("last_seen_at", { ascending: false }).limit(300),
      supabase.from("security_alerts").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("user_behavior").select("user_id,risk_score,session_count,total_session_seconds,sensitive_action_count,last_country").order("risk_score", { ascending: false }).limit(200),
    ]);
    setLogs((l.data as SecurityLog[]) || []);
    setDevices((d.data as TrustedDevice[]) || []);
    setAlerts((a.data as Alert[]) || []);
    setBehavior((b.data as BehaviorRow[]) || []);
    setLoading(false);
  }

  useEffect(() => { if (role === "admin") void load(); }, [role]);

  if (authLoading) return <PageLoader />;
  if (!user || role !== "admin") return <div className="p-10 text-center text-destructive">{t("adminSec.unauthorized")}</div>;

  const filteredLogs = logs.filter((l) => {
    if (actionFilter !== "all" && l.action !== actionFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return [l.action, l.country, l.browser, l.os, l.ip_address, l.user_id].some((v) => (v || "").toLowerCase().includes(q));
  });

  const uniqActions = Array.from(new Set(logs.map((l) => l.action)));
  const totalAlerts = alerts.filter((a) => !a.resolved).length;
  const highRisk = behavior.filter((b) => b.risk_score >= 60).length;

  async function resolveAlert(id: string) {
    await supabase.from("security_alerts").update({ resolved: true }).eq("id", id);
    await load();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("adminSec.center")}
        subtitle={t("adminSec.metaTitle")}
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> {t("common.refresh")}
          </Button>
        }
      />

      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard icon={Activity} label={t("adminSec.kpi.totalEvents")} value={logs.length} tone="default" />
          <StatCard icon={Smartphone} label={t("adminSec.kpi.devicesTracked")} value={devices.length} tone="default" />
          <StatCard icon={AlertTriangle} label={t("adminSec.kpi.openAlerts")} value={totalAlerts} tone={totalAlerts > 0 ? "warning" : "default"} />
          <StatCard icon={ShieldCheck} label={t("adminSec.kpi.highRisk")} value={highRisk} tone={highRisk > 0 ? "danger" : "default"} />
        </div>

        <div className="flex flex-wrap gap-2 border-b border-border">
          {(["logs", "alerts", "devices", "risk"] as const).map((tk) => (
            <button key={tk}
              onClick={() => setTab(tk)}
              className={`relative px-4 py-2 text-sm font-medium capitalize transition-colors ${tab === tk ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {t(`adminSec.tab.${tk}`)}
              {tab === tk && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-emerald-600" />}
            </button>
          ))}
        </div>

        {tab === "logs" && (
          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle>{t("adminSec.logs.title")}</CardTitle>
              <div className="flex flex-wrap gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("adminSec.logs.searchPh")} className="h-9 w-56 pl-8" />
                </div>
                <Select value={actionFilter} onValueChange={setActionFilter}>
                  <SelectTrigger className="h-9 w-44"><SelectValue placeholder={t("adminSec.logs.action")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("adminSec.logs.allActions")}</SelectItem>
                    {uniqActions.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                    <tr><th className="py-2">{t("adminSec.logs.when")}</th><th>{t("adminSec.logs.action")}</th><th>{t("adminSec.logs.user")}</th><th>{t("adminSec.logs.ipCountry")}</th><th>{t("adminSec.logs.device")}</th><th>{t("adminSec.logs.status")}</th></tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredLogs.map((l) => (
                      <tr key={l.id} className="hover:bg-surface/60">
                        <td className="py-2 pr-3 text-xs text-muted-foreground">{new Date(l.created_at).toLocaleString()}</td>
                        <td className="font-mono text-xs">{l.action}</td>
                        <td className="font-mono text-xs">{(l.user_id || "—").slice(0, 8)}</td>
                        <td className="text-xs"><Globe2 className="mr-1 inline h-3 w-3" />{l.ip_address || "—"} {l.country && `· ${l.country}`}</td>
                        <td className="text-xs">{l.browser || "—"} · {l.os || "—"}</td>
                        <td>{l.success ? <Badge variant="outline" className="border-emerald-500/40 text-emerald-700">{t("adminSec.ok")}</Badge> : <Badge variant="destructive">{t("adminSec.fail")}</Badge>}</td>
                      </tr>
                    ))}
                    {filteredLogs.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">{t("adminSec.logs.empty")}</td></tr>}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {tab === "alerts" && (
          <Card>
            <CardHeader><CardTitle>{t("adminSec.alerts.title")}</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {alerts.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">{t("adminSec.alerts.empty")}</p>}
              {alerts.map((a) => (
                <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge variant={a.severity === "high" ? "destructive" : "outline"}>{a.severity}</Badge>
                      <span className="font-medium">{a.alert_type}</span>
                      {a.resolved && <Badge variant="outline" className="border-emerald-500/40 text-emerald-700">{t("adminSec.alerts.resolved")}</Badge>}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{a.description} · {new Date(a.created_at).toLocaleString()} · {t("adminSec.user")} {(a.user_id || "—").slice(0, 8)}</p>
                  </div>
                  {!a.resolved && <Button size="sm" variant="outline" onClick={() => resolveAlert(a.id)}>{t("adminSec.alerts.resolve")}</Button>}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {tab === "devices" && (
          <Card>
            <CardHeader><CardTitle>{t("adminSec.devices.title")}</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                    <tr><th className="py-2">{t("adminSec.devices.label")}</th><th>{t("adminSec.logs.user")}</th><th>{t("adminSec.devices.country")}</th><th>{t("adminSec.devices.lastSeen")}</th><th>{t("adminSec.devices.trusted")}</th></tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {devices.map((d) => (
                      <tr key={d.id} className="hover:bg-surface/60">
                        <td className="py-2 pr-3">{d.label || `${d.browser} · ${d.os}`}</td>
                        <td className="font-mono text-xs">{d.user_id.slice(0, 8)}</td>
                        <td className="text-xs">{d.country || "—"}</td>
                        <td className="text-xs text-muted-foreground">{new Date(d.last_seen_at).toLocaleString()}</td>
                        <td>{d.trusted ? <Badge variant="outline" className="border-emerald-500/40 text-emerald-700">{t("adminSec.devices.trustedBadge")}</Badge> : <Badge variant="outline">{t("adminSec.devices.pending")}</Badge>}</td>
                      </tr>
                    ))}
                    {devices.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">{t("adminSec.devices.empty")}</td></tr>}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {tab === "risk" && (
          <Card>
            <CardHeader><CardTitle>{t("adminSec.risk.title")}</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                    <tr><th className="py-2">{t("adminSec.logs.user")}</th><th>{t("adminSec.risk.risk")}</th><th>{t("adminSec.risk.sessions")}</th><th>{t("adminSec.risk.sensitive")}</th><th>{t("adminSec.devices.country")}</th></tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {behavior.map((b) => (
                      <tr key={b.user_id} className="hover:bg-surface/60">
                        <td className="py-2 pr-3 font-mono text-xs">{b.user_id.slice(0, 8)}</td>
                        <td>
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-32 overflow-hidden rounded-full bg-muted">
                              <div className={`h-full ${b.risk_score >= 80 ? "bg-red-600" : b.risk_score >= 60 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, b.risk_score)}%` }} />
                            </div>
                            <span className="text-xs font-semibold">{b.risk_score}</span>
                          </div>
                        </td>
                        <td className="text-xs">{b.session_count} · {Math.round((b.total_session_seconds || 0) / 60)}m</td>
                        <td className="text-xs">{b.sensitive_action_count}</td>
                        <td className="text-xs">{b.last_country || "—"}</td>
                      </tr>
                    ))}
                    {behavior.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">{t("adminSec.risk.empty")}</td></tr>}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, tone }: { icon: typeof Activity; label: string; value: number; tone: "default" | "warning" | "danger" }) {
  const colors = {
    default: "text-foreground",
    warning: "text-amber-600",
    danger: "text-red-600",
  }[tone];
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-surface ${colors}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className={`text-2xl font-semibold ${colors}`}>{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}
