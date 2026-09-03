import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { statusLabel } from "@/lib/application-status";

export interface MonthPoint {
  key: string;
  label: string;
  count: number;
  volume: number;
  approved: number;
  disbursed: number;
  repaid: number;
}

const PIE_COLORS = ["#00915A", "#0EA5E9", "#F59E0B", "#EF4444", "#8B5CF6", "#14B8A6", "#64748B"];

function money(n: number) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
}

function Empty() {
  return <p className="grid h-full place-items-center text-sm text-muted-foreground">Aucune donnée</p>;
}

function toPie(map: Record<string, number>, limit = 7) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, value]) => ({ name, value }));
}

export function AdminAnalytics({
  months,
  byStatus,
  byCountry = {},
  byProduct = {},
}: {
  months: MonthPoint[];
  byStatus: Record<string, number>;
  byCountry?: Record<string, number>;
  byProduct?: Record<string, number>;
}) {
  const statusData = Object.entries(byStatus)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7)
    .map(([status, value]) => ({ name: statusLabel(status as never), value }));
  const countryData = toPie(byCountry);
  const productData = toPie(byProduct, 6);
  const hasSeries = months.some((m) => m.count || m.volume || m.approved || m.disbursed || m.repaid);

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card className="xl:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Volume demandé — 12 derniers mois</CardTitle>
        </CardHeader>
        <CardContent className="h-[260px] px-1 sm:px-4">
          {!hasSeries ? (
            <Empty />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={months} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="volumeFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#00915A" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#00915A" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" opacity={0.25} vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} tickLine={false} axisLine={false} fontSize={11} width={48} />
                <Tooltip formatter={(v: number) => money(Number(v))} />
                <Area type="monotone" name="Demandé" dataKey="volume" stroke="#00915A" strokeWidth={2} fill="url(#volumeFill)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Répartition par statut</CardTitle>
        </CardHeader>
        <CardContent className="h-[260px]">
          {statusData.length === 0 ? (
            <Empty />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80} paddingAngle={2}>
                  {statusData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Legend verticalAlign="bottom" iconSize={8} formatter={(v) => <span className="text-[11px]">{v}</span>} />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Montants approuvés, décaissés et remboursés</CardTitle>
        </CardHeader>
        <CardContent className="h-[260px] px-1 sm:px-4">
          {!hasSeries ? (
            <Empty />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={months} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.25} vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} tickLine={false} axisLine={false} fontSize={11} width={48} />
                <Tooltip formatter={(v: number) => money(Number(v))} />
                <Legend iconSize={8} formatter={(v) => <span className="text-[11px]">{v}</span>} />
                <Line type="monotone" name="Approuvé" dataKey="approved" stroke="#0EA5E9" strokeWidth={2} dot={false} />
                <Line type="monotone" name="Décaissé" dataKey="disbursed" stroke="#00915A" strokeWidth={2} dot={false} />
                <Line type="monotone" name="Remboursé" dataKey="repaid" stroke="#F59E0B" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Répartition par produit</CardTitle>
        </CardHeader>
        <CardContent className="h-[260px]">
          {productData.length === 0 ? (
            <Empty />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={productData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80} paddingAngle={2}>
                  {productData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[(i + 2) % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Legend verticalAlign="bottom" iconSize={8} formatter={(v) => <span className="text-[11px]">{v}</span>} />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Nombre de dossiers déposés</CardTitle>
        </CardHeader>
        <CardContent className="h-[220px] px-1 sm:px-4">
          {!hasSeries ? (
            <Empty />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={months} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.25} vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} width={32} />
                <Tooltip />
                <Bar dataKey="count" name="Dossiers" fill="#0EA5E9" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Répartition par pays</CardTitle>
        </CardHeader>
        <CardContent className="h-[220px] px-1 sm:px-4">
          {countryData.length === 0 ? (
            <Empty />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={countryData} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.25} horizontal={false} />
                <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} />
                <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} fontSize={11} width={48} />
                <Tooltip />
                <Bar dataKey="value" name="Dossiers" fill="#8B5CF6" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
