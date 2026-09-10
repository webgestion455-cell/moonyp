/**
 * Types partagés du module Google Ads Analytics.
 * Aucun secret ici : ces types circulent aussi côté navigateur.
 */

export type DatePreset =
  | "today"
  | "yesterday"
  | "last_7"
  | "last_30"
  | "last_90"
  | "this_year"
  | "custom";

export interface DateRange {
  /** ISO yyyy-mm-dd */
  start: string;
  /** ISO yyyy-mm-dd */
  end: string;
}

export interface AdsMetrics {
  impressions: number;
  clicks: number;
  ctr: number;
  averageCpc: number;
  cost: number;
  conversions: number;
  costPerConversion: number;
  conversionsValue: number;
  roas: number | null;
}

export interface AdsTimePoint extends AdsMetrics {
  date: string;
}

export interface AdsCampaignRow extends AdsMetrics {
  id: string;
  name: string;
  status: "ENABLED" | "PAUSED" | "REMOVED" | "UNKNOWN";
  channel: string | null;
  budget: number | null;
}

export interface AdsKeywordRow extends AdsMetrics {
  keyword: string;
  matchType: string | null;
  campaign: string | null;
}

export interface AdsGeoRow extends AdsMetrics {
  criterionId: string;
  label: string;
  level: "country" | "region" | "city";
}

export interface AdsDeviceRow extends AdsMetrics {
  device: "DESKTOP" | "MOBILE" | "TABLET" | "OTHER";
}

export interface AdsAudienceStats {
  /** Visiteurs issus de Google Ads (clics dédupliqués par utilisateur estimé). */
  visitors: number;
  sessions: number;
  newVisitors: number;
  returningVisitors: number;
}

export type AdsAlertLevel = "info" | "warning" | "critical";

export interface AdsAlert {
  id: string;
  level: AdsAlertLevel;
  title: string;
  detail: string;
}

export interface AdsConfigStatus {
  configured: boolean;
  missing: string[];
  customerIdMasked: string | null;
  lastSyncAt: string | null;
  cached: boolean;
}

export interface AdsDashboardPayload {
  status: AdsConfigStatus;
  range: DateRange;
  compareRange: DateRange | null;
  totals: AdsMetrics;
  compareTotals: AdsMetrics | null;
  timeseries: AdsTimePoint[];
  campaigns: AdsCampaignRow[];
  keywords: AdsKeywordRow[];
  geo: AdsGeoRow[];
  devices: AdsDeviceRow[];
  audience: AdsAudienceStats;
  alerts: AdsAlert[];
}

export const EMPTY_METRICS: AdsMetrics = {
  impressions: 0,
  clicks: 0,
  ctr: 0,
  averageCpc: 0,
  cost: 0,
  conversions: 0,
  costPerConversion: 0,
  conversionsValue: 0,
  roas: null,
};

/** Dates d'un préréglage, calculées en UTC. */
export function presetRange(preset: DatePreset, custom?: DateRange): DateRange {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const today = new Date();
  const day = (n: number) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - n);
    return d;
  };
  switch (preset) {
    case "today":
      return { start: iso(today), end: iso(today) };
    case "yesterday":
      return { start: iso(day(1)), end: iso(day(1)) };
    case "last_7":
      return { start: iso(day(6)), end: iso(today) };
    case "last_90":
      return { start: iso(day(89)), end: iso(today) };
    case "this_year":
      return { start: `${today.getUTCFullYear()}-01-01`, end: iso(today) };
    case "custom":
      return custom ?? { start: iso(day(29)), end: iso(today) };
    case "last_30":
    default:
      return { start: iso(day(29)), end: iso(today) };
  }
}

/** Période immédiatement précédente, de même longueur. */
export function previousRange(range: DateRange): DateRange {
  const start = new Date(`${range.start}T00:00:00Z`);
  const end = new Date(`${range.end}T00:00:00Z`);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  const prevEnd = new Date(start);
  prevEnd.setUTCDate(prevEnd.getUTCDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setUTCDate(prevStart.getUTCDate() - (days - 1));
  return { start: prevStart.toISOString().slice(0, 10), end: prevEnd.toISOString().slice(0, 10) };
}
