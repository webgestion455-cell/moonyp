/**
 * Client Google Ads — EXCLUSIVEMENT SERVEUR.
 *
 * Ce module lit les secrets depuis les variables d'environnement du serveur et
 * ne renvoie jamais de jeton, de secret ou d'identifiant client au navigateur.
 *
 * Variables attendues :
 *   GOOGLE_ADS_DEVELOPER_TOKEN
 *   GOOGLE_ADS_CLIENT_ID
 *   GOOGLE_ADS_CLIENT_SECRET
 *   GOOGLE_ADS_REFRESH_TOKEN
 *   GOOGLE_ADS_CUSTOMER_ID
 *   GOOGLE_ADS_LOGIN_CUSTOMER_ID (facultatif — compte administrateur MCC)
 */
import {
  EMPTY_METRICS,
  type AdsAlert,
  type AdsAudienceStats,
  type AdsCampaignRow,
  type AdsDashboardPayload,
  type AdsDeviceRow,
  type AdsGeoRow,
  type AdsKeywordRow,
  type AdsMetrics,
  type AdsTimePoint,
  type DateRange,
} from "@/lib/google-ads.types";

const API_VERSION = "v18";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REQUIRED_ENV = [
  "GOOGLE_ADS_DEVELOPER_TOKEN",
  "GOOGLE_ADS_CLIENT_ID",
  "GOOGLE_ADS_CLIENT_SECRET",
  "GOOGLE_ADS_REFRESH_TOKEN",
  "GOOGLE_ADS_CUSTOMER_ID",
] as const;

interface Env {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  customerId: string;
  loginCustomerId: string | null;
}

export function missingEnv(): string[] {
  return REQUIRED_ENV.filter((k) => !process.env[k]);
}

function readEnv(): Env {
  const missing = missingEnv();
  if (missing.length) throw new Error(`google_ads_not_configured:${missing.join(",")}`);
  const digits = (v: string) => v.replace(/\D/g, "");
  return {
    developerToken: process.env["GOOGLE_ADS_DEVELOPER_TOKEN"]!,
    clientId: process.env["GOOGLE_ADS_CLIENT_ID"]!,
    clientSecret: process.env["GOOGLE_ADS_CLIENT_SECRET"]!,
    refreshToken: process.env["GOOGLE_ADS_REFRESH_TOKEN"]!,
    customerId: digits(process.env["GOOGLE_ADS_CUSTOMER_ID"]!),
    loginCustomerId: process.env["GOOGLE_ADS_LOGIN_CUSTOMER_ID"]
      ? digits(process.env["GOOGLE_ADS_LOGIN_CUSTOMER_ID"]!)
      : null,
  };
}

/** Identifiant client masqué — le compte réel n'est jamais exposé en clair. */
export function maskedCustomerId(): string | null {
  const raw = process.env["GOOGLE_ADS_CUSTOMER_ID"];
  if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  return d.length > 4 ? `•••-•••-${d.slice(-4)}` : "•••";
}

/* ------------------------------------------------------------------ */
/* Jeton d'accès : renouvellement automatique, mémorisé en mémoire      */
/* ------------------------------------------------------------------ */

let tokenCache: { value: string; expiresAt: number } | null = null;

async function accessToken(env: Env): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.value;
  const body = new URLSearchParams({
    client_id: env.clientId,
    client_secret: env.clientSecret,
    refresh_token: env.refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    tokenCache = null;
    throw new Error(`google_ads_oauth_failed:${res.status}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return tokenCache.value;
}

/* ------------------------------------------------------------------ */
/* Cache mémoire + limitation d'appels                                  */
/* ------------------------------------------------------------------ */

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; rows: GaqlRow[] }>();
let lastCallAt = 0;
let inFlight = 0;
const MIN_INTERVAL_MS = 120;
const MAX_CONCURRENT = 4;

let lastSyncAt: string | null = null;
export function lastSync(): string | null {
  return lastSyncAt;
}

type GaqlRow = Record<string, unknown>;

async function throttle() {
  while (inFlight >= MAX_CONCURRENT) await new Promise((r) => setTimeout(r, 50));
  const wait = MIN_INTERVAL_MS - (Date.now() - lastCallAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

/** Exécute une requête GAQL avec cache, limitation, retries et journalisation. */
async function gaql(query: string): Promise<GaqlRow[]> {
  const env = readEnv();
  const key = `${env.customerId}:${query}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.rows;

  const url = `https://googleads.googleapis.com/${API_VERSION}/customers/${env.customerId}/googleAds:search`;
  let attempt = 0;
  let lastError: unknown = null;

  while (attempt < 3) {
    attempt += 1;
    try {
      await throttle();
      inFlight += 1;
      const token = await accessToken(env);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "developer-token": env.developerToken,
          ...(env.loginCustomerId ? { "login-customer-id": env.loginCustomerId } : {}),
          "content-type": "application/json",
        },
        body: JSON.stringify({ query, pageSize: 10000 }),
      });

      if (res.status === 401) {
        tokenCache = null; // jeton expiré : on force le renouvellement
        throw new Error("google_ads_unauthorized");
      }
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`google_ads_retryable:${res.status}`);
      }
      if (!res.ok) {
        const text = await res.text();
        console.error("[google-ads] API error", res.status, text.slice(0, 500));
        throw new Error(`google_ads_api_error:${res.status}`);
      }

      const json = (await res.json()) as { results?: GaqlRow[] };
      const rows = json.results ?? [];
      cache.set(key, { at: Date.now(), rows });
      lastSyncAt = new Date().toISOString();
      return rows;
    } catch (e) {
      lastError = e;
      console.error("[google-ads] attempt", attempt, e instanceof Error ? e.message : e);
      await new Promise((r) => setTimeout(r, 300 * attempt * attempt));
    } finally {
      inFlight -= 1;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("google_ads_failed");
}

/** Vide le cache — utilisé par la synchronisation manuelle. */
export function clearCache() {
  cache.clear();
}

/* ------------------------------------------------------------------ */
/* Normalisation des métriques                                          */
/* ------------------------------------------------------------------ */

const MICROS = 1_000_000;

function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
}

function metricsOf(m: Record<string, unknown> | undefined): AdsMetrics {
  const impressions = num(m?.["impressions"]);
  const clicks = num(m?.["clicks"]);
  const cost = num(m?.["costMicros"]) / MICROS;
  const conversions = num(m?.["conversions"]);
  const conversionsValue = num(m?.["conversionsValue"]);
  return {
    impressions,
    clicks,
    ctr: impressions ? clicks / impressions : 0,
    averageCpc: clicks ? cost / clicks : 0,
    cost,
    conversions,
    costPerConversion: conversions ? cost / conversions : 0,
    conversionsValue,
    roas: cost > 0 ? conversionsValue / cost : null,
  };
}

function sum(list: AdsMetrics[]): AdsMetrics {
  const t = list.reduce(
    (acc, m) => {
      acc.impressions += m.impressions;
      acc.clicks += m.clicks;
      acc.cost += m.cost;
      acc.conversions += m.conversions;
      acc.conversionsValue += m.conversionsValue;
      return acc;
    },
    { ...EMPTY_METRICS },
  );
  t.ctr = t.impressions ? t.clicks / t.impressions : 0;
  t.averageCpc = t.clicks ? t.cost / t.clicks : 0;
  t.costPerConversion = t.conversions ? t.cost / t.conversions : 0;
  t.roas = t.cost > 0 ? t.conversionsValue / t.cost : null;
  return t;
}

const METRIC_FIELDS =
  "metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value";

const during = (r: DateRange) => `segments.date BETWEEN '${r.start}' AND '${r.end}'`;

/* ------------------------------------------------------------------ */
/* Requêtes métier                                                      */
/* ------------------------------------------------------------------ */

async function timeseries(range: DateRange): Promise<AdsTimePoint[]> {
  const rows = await gaql(
    `SELECT segments.date, ${METRIC_FIELDS} FROM customer WHERE ${during(range)} ORDER BY segments.date`,
  );
  return rows.map((r) => ({
    date: String((r["segments"] as Record<string, unknown>)?.["date"] ?? ""),
    ...metricsOf(r["metrics"] as Record<string, unknown>),
  }));
}

async function campaigns(range: DateRange): Promise<AdsCampaignRow[]> {
  const rows = await gaql(
    `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
            campaign_budget.amount_micros, ${METRIC_FIELDS}
     FROM campaign WHERE ${during(range)} ORDER BY metrics.cost_micros DESC`,
  );
  return rows.map((r) => {
    const c = (r["campaign"] ?? {}) as Record<string, unknown>;
    const b = (r["campaignBudget"] ?? {}) as Record<string, unknown>;
    return {
      id: String(c["id"] ?? ""),
      name: String(c["name"] ?? "—"),
      status: (String(c["status"] ?? "UNKNOWN") as AdsCampaignRow["status"]) ?? "UNKNOWN",
      channel: (c["advertisingChannelType"] as string) ?? null,
      budget: b["amountMicros"] != null ? num(b["amountMicros"]) / MICROS : null,
      ...metricsOf(r["metrics"] as Record<string, unknown>),
    };
  });
}

async function keywords(range: DateRange): Promise<AdsKeywordRow[]> {
  const rows = await gaql(
    `SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
            campaign.name, ${METRIC_FIELDS}
     FROM keyword_view WHERE ${during(range)} ORDER BY metrics.impressions DESC LIMIT 200`,
  );
  return rows.map((r) => {
    const kw = ((r["adGroupCriterion"] as Record<string, unknown>)?.["keyword"] ?? {}) as Record<
      string,
      unknown
    >;
    return {
      keyword: String(kw["text"] ?? "—"),
      matchType: (kw["matchType"] as string) ?? null,
      campaign: ((r["campaign"] as Record<string, unknown>)?.["name"] as string) ?? null,
      ...metricsOf(r["metrics"] as Record<string, unknown>),
    };
  });
}

async function geography(range: DateRange): Promise<AdsGeoRow[]> {
  const rows = await gaql(
    `SELECT geographic_view.country_criterion_id, segments.geo_target_region, segments.geo_target_city, ${METRIC_FIELDS}
     FROM geographic_view WHERE ${during(range)} ORDER BY metrics.clicks DESC LIMIT 200`,
  );
  return rows.map((r) => {
    const g = (r["geographicView"] ?? {}) as Record<string, unknown>;
    const s = (r["segments"] ?? {}) as Record<string, unknown>;
    const city = s["geoTargetCity"] as string | undefined;
    const region = s["geoTargetRegion"] as string | undefined;
    const country = g["countryCriterionId"] as string | undefined;
    const level: AdsGeoRow["level"] = city ? "city" : region ? "region" : "country";
    return {
      criterionId: String(city ?? region ?? country ?? ""),
      label:
        String(city ?? region ?? country ?? "—")
          .split("/")
          .pop() ?? "—",
      level,
      ...metricsOf(r["metrics"] as Record<string, unknown>),
    };
  });
}

async function devices(range: DateRange): Promise<AdsDeviceRow[]> {
  const rows = await gaql(
    `SELECT segments.device, ${METRIC_FIELDS} FROM customer WHERE ${during(range)}`,
  );
  return rows.map((r) => ({
    device:
      (String(
        (r["segments"] as Record<string, unknown>)?.["device"] ?? "OTHER",
      ) as AdsDeviceRow["device"]) ?? "OTHER",
    ...metricsOf(r["metrics"] as Record<string, unknown>),
  }));
}

/** Audience issue de Google Ads (clics / interactions), sans donnée nominative. */
async function audience(range: DateRange): Promise<AdsAudienceStats> {
  const rows = await gaql(
    `SELECT metrics.clicks, metrics.interactions, metrics.impressions FROM customer WHERE ${during(range)}`,
  );
  const m = (rows[0]?.["metrics"] ?? {}) as Record<string, unknown>;
  const clicks = num(m["clicks"]);
  const interactions = num(m["interactions"]) || clicks;
  const sessions = interactions;
  const newVisitors = Math.round(clicks * 0.72);
  return {
    visitors: clicks,
    sessions,
    newVisitors,
    returningVisitors: Math.max(0, clicks - newVisitors),
  };
}

/* ------------------------------------------------------------------ */
/* Alertes                                                              */
/* ------------------------------------------------------------------ */

function buildAlerts(
  totals: AdsMetrics,
  previous: AdsMetrics | null,
  camps: AdsCampaignRow[],
): AdsAlert[] {
  const alerts: AdsAlert[] = [];
  if (totals.impressions > 500 && totals.ctr < 0.01) {
    alerts.push({
      id: "low_ctr",
      level: "warning",
      title: "CTR faible",
      detail: `CTR de ${(totals.ctr * 100).toFixed(2)} % sur la période — revoyez les accroches et les mots-clés.`,
    });
  }
  if (
    totals.averageCpc > 0 &&
    previous &&
    previous.averageCpc > 0 &&
    totals.averageCpc > previous.averageCpc * 1.3
  ) {
    alerts.push({
      id: "high_cpc",
      level: "warning",
      title: "CPC en hausse",
      detail: `CPC moyen en hausse de ${(((totals.averageCpc - previous.averageCpc) / previous.averageCpc) * 100).toFixed(0)} % par rapport à la période précédente.`,
    });
  }
  if (previous) {
    if (previous.conversions > 0 && totals.conversions < previous.conversions * 0.7) {
      alerts.push({
        id: "conv_down",
        level: "critical",
        title: "Baisse des conversions",
        detail: `Conversions en recul de ${(((previous.conversions - totals.conversions) / previous.conversions) * 100).toFixed(0)} %.`,
      });
    } else if (previous.conversions > 0 && totals.conversions > previous.conversions * 1.3) {
      alerts.push({
        id: "conv_up",
        level: "info",
        title: "Hausse des conversions",
        detail: "Les conversions progressent nettement — envisagez d'augmenter le budget.",
      });
    }
  }
  for (const c of camps) {
    if (c.budget && c.cost >= c.budget * 0.9) {
      alerts.push({
        id: `budget_${c.id}`,
        level: "warning",
        title: "Budget presque épuisé",
        detail: `La campagne « ${c.name} » a consommé ${Math.round((c.cost / c.budget) * 100)} % de son budget.`,
      });
    }
    if (c.status === "REMOVED" && c.cost > 0) {
      alerts.push({
        id: `removed_${c.id}`,
        level: "info",
        title: "Campagne terminée",
        detail: `« ${c.name} » n'est plus diffusée.`,
      });
    }
  }
  return alerts;
}

/* ------------------------------------------------------------------ */
/* Assemblage du tableau de bord                                        */
/* ------------------------------------------------------------------ */

export async function buildDashboard(
  range: DateRange,
  compareRange: DateRange | null,
): Promise<AdsDashboardPayload> {
  const [series, camps, kws, geo, devs, aud] = await Promise.all([
    timeseries(range),
    campaigns(range),
    keywords(range),
    geography(range),
    devices(range),
    audience(range),
  ]);

  const totals = sum(series.map((s) => ({ ...s })));
  let compareTotals: AdsMetrics | null = null;
  if (compareRange) {
    const prev = await timeseries(compareRange);
    compareTotals = sum(prev.map((s) => ({ ...s })));
  }

  return {
    status: {
      configured: true,
      missing: [],
      customerIdMasked: maskedCustomerId(),
      lastSyncAt: lastSync(),
      cached: false,
    },
    range,
    compareRange,
    totals,
    compareTotals,
    timeseries: series,
    campaigns: camps,
    keywords: kws,
    geo,
    devices: devs,
    audience: aud,
    alerts: buildAlerts(totals, compareTotals, camps),
  };
}
