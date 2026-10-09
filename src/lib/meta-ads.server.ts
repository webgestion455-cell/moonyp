/**
 * Meta Ads — reporting STRICTEMENT en lecture seule.
 *
 * - Uniquement des requêtes GET vers la Meta Marketing API officielle (Graph API).
 * - Aucun champ de budget n'est demandé ; aucune requête d'écriture n'existe ici.
 * - Les identifiants vivent dans les secrets serveur (jamais en base, jamais côté client).
 * - Chaque appel porte un `appsecret_proof` (HMAC-SHA256 du jeton par l'App Secret).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const db = supabaseAdmin as any;

export const META_SYNC_INTERVAL_MIN = 15;
export const PRESETS = ["today", "last_7d", "last_30d", "this_month"] as const;
export type Preset = (typeof PRESETS)[number];
const DAILY_LOOKBACK_DAYS = 37;
const MAX_PAGES = 20;

export interface MetaSettings {
  enabled: boolean;
  show_spend: boolean;
}
const DEFAULT_SETTINGS: MetaSettings = { enabled: true, show_spend: false };

export function metaEnv() {
  return {
    appId: process.env["META_APP_ID"] ?? "",
    appSecret: process.env["META_APP_SECRET"] ?? "",
    token: process.env["META_ACCESS_TOKEN"] ?? "",
    accountFilter: (process.env["META_AD_ACCOUNT_IDS"] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => (s.startsWith("act_") ? s : `act_${s}`)),
    version: process.env["META_GRAPH_VERSION"] || "v23.0",
  };
}

export function missingMetaEnv(): string[] {
  const e = metaEnv();
  return [
    !e.appId && "META_APP_ID",
    !e.appSecret && "META_APP_SECRET",
    !e.token && "META_ACCESS_TOKEN",
  ].filter(Boolean) as string[];
}

export async function getMetaSettings(): Promise<MetaSettings> {
  const { data } = await db.from("system_settings").select("value").eq("key", "meta_ads").maybeSingle();
  return { ...DEFAULT_SETTINGS, ...((data?.value as Partial<MetaSettings>) ?? {}) };
}

export async function saveMetaSettings(patch: Partial<MetaSettings>, userId: string) {
  const next = { ...(await getMetaSettings()), ...patch };
  await db
    .from("system_settings")
    .upsert({ key: "meta_ads", value: next, public: false, updated_by: userId }, { onConflict: "key" });
  return next;
}

/* ------------------------------- Graph client ------------------------------ */

export class MetaApiError extends Error {
  constructor(
    public kind: "token_invalid" | "not_authorized" | "rate_limited" | "invalid_field" | "api_error",
    message: string,
    public code?: number,
  ) {
    super(message);
  }
}

async function appSecretProof(token: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function classify(code: number | undefined, sub: number | undefined): MetaApiError["kind"] {
  if (code === 190 || code === 102 || code === 463 || code === 467) return "token_invalid";
  if (code === 10 || code === 200 || code === 294 || (code && code >= 270 && code <= 299)) return "not_authorized";
  if ([4, 17, 32, 613].includes(code ?? -1) || (code && code >= 80000 && code <= 80014) || sub === 2446079)
    return "rate_limited";
  if (code === 100) return "invalid_field";
  return "api_error";
}

/** Usage quota reported by Meta (max percent across headers). */
function usagePercent(res: Response): number {
  let max = 0;
  for (const h of ["x-business-use-case-usage", "x-ad-account-usage", "x-app-usage"]) {
    const raw = res.headers.get(h);
    if (!raw) continue;
    const nums = raw.match(/"(?:call_count|total_cputime|total_time|acc_id_util_pct)"\s*:\s*(\d+(?:\.\d+)?)/g) ?? [];
    for (const n of nums) max = Math.max(max, Number(n.split(":")[1]));
  }
  return max;
}

let proofCache: { token: string; proof: string } | null = null;

async function graphGet(path: string, params: Record<string, string>) {
  const e = metaEnv();
  if (!proofCache || proofCache.token !== e.token) {
    proofCache = { token: e.token, proof: await appSecretProof(e.token, e.appSecret) };
  }
  const url = new URL(`https://graph.facebook.com/${e.version}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", e.token);
  url.searchParams.set("appsecret_proof", proofCache.proof);
  return fetchJson(url.toString());
}

async function fetchJson(url: string) {
  const res = await fetch(url, { method: "GET" });
  const body = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || body?.error) {
    const err = body?.error ?? {};
    // Message Meta sans jeton (l'URL n'est jamais incluse).
    throw new MetaApiError(classify(err.code, err.error_subcode), String(err.message ?? `HTTP ${res.status}`).slice(0, 300), err.code);
  }
  if (usagePercent(res) >= 90) {
    throw new MetaApiError("rate_limited", "Quota Meta proche de la limite : synchronisation reportée.");
  }
  return body;
}

async function graphAll(path: string, params: Record<string, string>) {
  const out: any[] = [];
  let page = await graphGet(path, { limit: "500", ...params });
  for (let i = 0; i < MAX_PAGES; i++) {
    out.push(...(page.data ?? []));
    const next: string | undefined = page.paging?.next;
    if (!next) break;
    page = await fetchJson(next); // URL "next" fournie par Meta (contient déjà jeton + proof)
  }
  return out;
}

/* --------------------------------- Status --------------------------------- */

export async function debugToken() {
  const e = metaEnv();
  const url = new URL(`https://graph.facebook.com/${e.version}/debug_token`);
  url.searchParams.set("input_token", e.token);
  url.searchParams.set("access_token", `${e.appId}|${e.appSecret}`);
  const body = await fetchJson(url.toString());
  const d = body.data ?? {};
  const scopes: string[] = d.scopes ?? [];
  return {
    is_valid: d.is_valid === true,
    type: (d.type as string) ?? null,
    expires_at: d.expires_at ? new Date(d.expires_at * 1000).toISOString() : null, // null = n'expire pas
    data_access_expires_at: d.data_access_expires_at ? new Date(d.data_access_expires_at * 1000).toISOString() : null,
    scopes,
    has_ads_read: scopes.includes("ads_read") || scopes.includes("ads_management"),
    write_capable: scopes.includes("ads_management"),
  };
}

export async function listAccounts() {
  const rows = await graphAll("me/adaccounts", {
    fields: "id,name,currency,account_status,timezone_name",
  });
  const filter = metaEnv().accountFilter;
  return filter.length ? rows.filter((r) => filter.includes(r.id)) : rows;
}

/* ---------------------------------- Sync ---------------------------------- */

const BASE_FIELDS = [
  "account_id",
  "campaign_id",
  "campaign_name",
  "adset_id",
  "adset_name",
  "ad_id",
  "ad_name",
  "date_start",
  "date_stop",
  "impressions",
  "reach",
  "frequency",
  "clicks",
  "inline_link_clicks",
  "outbound_clicks",
  "ctr",
  "cpc",
  "cpm",
  "spend",
  "actions",
  "conversions",
  "cost_per_action_type",
];
const VIDEO_FIELDS = [
  "video_play_actions",
  "video_p25_watched_actions",
  "video_p50_watched_actions",
  "video_p75_watched_actions",
  "video_p100_watched_actions",
  "video_thruplay_watched_actions",
  "video_avg_time_watched_actions",
];
let videoSupported = true;

async function insights(accountId: string, params: Record<string, string>) {
  const fields = (videoSupported ? [...BASE_FIELDS, ...VIDEO_FIELDS] : BASE_FIELDS).join(",");
  try {
    return await graphAll(`${accountId}/insights`, { fields, ...params });
  } catch (e) {
    if (e instanceof MetaApiError && e.kind === "invalid_field" && videoSupported) {
      videoSupported = false; // champ vidéo retiré par Meta : on poursuit sans, ils resteront « indisponibles »
      return graphAll(`${accountId}/insights`, { fields: BASE_FIELDS.join(","), ...params });
    }
    throw e;
  }
}

function metricsOf(row: Record<string, unknown>) {
  const m: Record<string, unknown> = {};
  for (const k of [...BASE_FIELDS, ...VIDEO_FIELDS]) {
    if (k.endsWith("_id") || k.endsWith("_name") || k.startsWith("date_")) continue;
    if (row[k] !== undefined) m[k] = row[k];
  }
  return m;
}

const idOf = (level: string, r: any) =>
  level === "campaign" ? r.campaign_id : level === "adset" ? r.adset_id : level === "ad" ? r.ad_id : `act_${r.account_id}`;

async function upsertChunks(table: string, rows: any[], onConflict: string) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + 500), { onConflict });
    if (error) throw new Error(error.message);
  }
}

async function syncAccount(acc: any, stats: Record<string, number>) {
  const id = acc.id as string;
  await db.from("meta_ads_accounts").upsert(
    { id, name: acc.name, currency: acc.currency, account_status: acc.account_status, timezone_name: acc.timezone_name },
    { onConflict: "id" },
  );

  // Métadonnées (aucun champ budget demandé).
  const [campaigns, adsets, ads] = await Promise.all([
    graphAll(`${id}/campaigns`, { fields: "id,name,status,effective_status,objective,start_time,stop_time" }),
    graphAll(`${id}/adsets`, { fields: "id,name,campaign_id,status,effective_status,start_time,end_time" }),
    graphAll(`${id}/ads`, { fields: "id,name,campaign_id,adset_id,status,effective_status" }),
  ]);
  const objects = [
    ...campaigns.map((c) => ({ id: c.id, level: "campaign", account_id: id, name: c.name, status: c.status, effective_status: c.effective_status, objective: c.objective ?? null, start_time: c.start_time ?? null, stop_time: c.stop_time ?? null })),
    ...adsets.map((a) => ({ id: a.id, level: "adset", account_id: id, campaign_id: a.campaign_id, name: a.name, status: a.status, effective_status: a.effective_status, start_time: a.start_time ?? null, stop_time: a.end_time ?? null })),
    ...ads.map((a) => ({ id: a.id, level: "ad", account_id: id, campaign_id: a.campaign_id, adset_id: a.adset_id, name: a.name, status: a.status, effective_status: a.effective_status })),
  ];
  await upsertChunks("meta_ads_objects", objects, "id");
  stats.objects = (stats.objects ?? 0) + objects.length;

  // Historique quotidien (Meta révise l'attribution : on réécrit la fenêtre récente, sans doublon).
  const until = new Date();
  const since = new Date(Date.now() - DAILY_LOOKBACK_DAYS * 86_400_000);
  const time_range = JSON.stringify({ since: since.toISOString().slice(0, 10), until: until.toISOString().slice(0, 10) });
  for (const level of ["campaign", "adset", "ad"] as const) {
    const rows = await insights(id, { level, time_increment: "1", time_range });
    await upsertChunks(
      "meta_ads_insights_daily",
      rows.map((r) => ({
        level,
        object_id: idOf(level, r),
        date: r.date_start,
        account_id: id,
        campaign_id: r.campaign_id ?? null,
        adset_id: r.adset_id ?? null,
        metrics: metricsOf(r),
        synced_at: new Date().toISOString(),
      })),
      "level,object_id,date",
    );
    stats.daily_rows = (stats.daily_rows ?? 0) + rows.length;
  }

  // Agrégats officiels par période (seule source fiable pour la portée et la fréquence).
  for (const preset of PRESETS) {
    for (const level of ["account", "campaign", "adset", "ad"] as const) {
      const rows = await insights(id, { level, date_preset: preset });
      if (level !== "account") {
        await db.from("meta_ads_insights_period").delete().eq("preset", preset).eq("level", level).eq("account_id", id);
      }
      await upsertChunks(
        "meta_ads_insights_period",
        rows.map((r) => ({
          preset,
          level,
          object_id: idOf(level, r),
          account_id: id,
          campaign_id: r.campaign_id ?? null,
          adset_id: r.adset_id ?? null,
          date_start: r.date_start,
          date_stop: r.date_stop,
          metrics: metricsOf(r),
          synced_at: new Date().toISOString(),
        })),
        "preset,level,object_id",
      );
      if (level === "account" && rows.length === 0) {
        // Aucune diffusion sur la période : réponse valide et vide de Meta.
        await db.from("meta_ads_insights_period").delete().eq("preset", preset).eq("level", "account").eq("account_id", id);
      }
    }
  }
  await db.from("meta_ads_accounts").update({ last_synced_at: new Date().toISOString() }).eq("id", id);
}

export async function runMetaSync(trigger: "cron" | "manual" | "auto", userId: string | null) {
  if (missingMetaEnv().length) return { status: "not_configured" as const };
  const settings = await getMetaSettings();
  if (!settings.enabled) return { status: "disabled" as const };

  // Verrou simple : une seule synchro à la fois.
  const tenMin = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data: running } = await db
    .from("meta_ads_sync_runs")
    .select("id")
    .eq("status", "running")
    .gte("started_at", tenMin)
    .limit(1);
  if (running?.length) return { status: "already_running" as const };

  const { data: run } = await db
    .from("meta_ads_sync_runs")
    .insert({ trigger, triggered_by: userId })
    .select("id")
    .single();
  const stats: Record<string, number> = {};
  const failures: string[] = [];
  let fatal: MetaApiError | Error | null = null;

  try {
    const accounts = await listAccounts();
    stats.accounts = accounts.length;
    for (const acc of accounts) {
      try {
        await syncAccount(acc, stats);
      } catch (e) {
        if (e instanceof MetaApiError && (e.kind === "token_invalid" || e.kind === "rate_limited")) throw e;
        failures.push(`${acc.id}: ${e instanceof MetaApiError ? e.kind : "error"}`);
      }
    }
  } catch (e) {
    fatal = e as Error;
  }

  const status = fatal ? "error" : failures.length ? "partial" : "success";
  await db
    .from("meta_ads_sync_runs")
    .update({
      status,
      finished_at: new Date().toISOString(),
      stats,
      error_code: fatal instanceof MetaApiError ? fatal.kind : fatal ? "internal" : failures.length ? "partial" : null,
      error_message: fatal ? fatal.message.slice(0, 300) : failures.join(" | ").slice(0, 300) || null,
    })
    .eq("id", run.id);
  return { status };
}

export async function lastRuns() {
  const { data } = await db
    .from("meta_ads_sync_runs")
    .select("id, trigger, status, error_code, error_message, stats, started_at, finished_at")
    .order("started_at", { ascending: false })
    .limit(10);
  return (data ?? []) as Array<{
    id: string;
    trigger: string;
    status: string;
    error_code: string | null;
    error_message: string | null;
    stats: Record<string, number>;
    started_at: string;
    finished_at: string | null;
  }>;
}

/* ------------------------------ Normalisation ------------------------------ */

/** null = indisponible (Meta n'a pas renvoyé la métrique). 0 = zéro réel. */
export type Metrics = Record<string, number | null>;

const ADDITIVE = ["impressions", "clicks", "inline_link_clicks", "spend"];
const ACTION_LISTS = ["outbound_clicks", "conversions", "video_play_actions", "video_p25_watched_actions", "video_p50_watched_actions", "video_p75_watched_actions", "video_p100_watched_actions", "video_thruplay_watched_actions"];

const sumList = (v: unknown) =>
  Array.isArray(v) ? v.reduce((s, a: any) => s + Number(a?.value ?? 0), 0) : null;

/** Agrège des lignes Meta brutes. `official` = ligne de période Meta (portée/fréquence fiables). */
export function aggregate(rows: Array<Record<string, unknown>>, official = false): Metrics & { _actions?: any } {
  const out: Metrics = {};
  const actions: Record<string, number> = {};
  const has = (k: string) => rows.some((r) => r[k] !== undefined);
  for (const k of ADDITIVE) out[k] = has(k) ? rows.reduce((s, r) => s + Number(r[k] ?? 0), 0) : null;
  for (const k of ACTION_LISTS) out[k] = has(k) ? rows.reduce((s, r) => s + (sumList(r[k]) ?? 0), 0) : null;
  for (const r of rows)
    for (const a of (r.actions as any[]) ?? []) actions[a.action_type] = (actions[a.action_type] ?? 0) + Number(a.value ?? 0);
  out.actions_total = has("actions") ? Object.values(actions).reduce((s, n) => s + n, 0) : null;

  if (official && rows.length === 1) {
    const r = rows[0];
    for (const k of ["reach", "frequency", "ctr", "cpc", "cpm"]) out[k] = r[k] !== undefined ? Number(r[k]) : null;
  } else {
    // Portée et fréquence ne s'additionnent pas : indisponibles hors période officielle.
    out.reach = null;
    out.frequency = null;
    const i = out.impressions, c = out.clicks, s = out.spend;
    out.ctr = i && c !== null ? (c / i) * 100 : i === 0 ? 0 : null;
    out.cpc = c && s !== null ? s / c : null;
    out.cpm = i && s !== null ? (s / i) * 1000 : null;
  }
  out.cost_per_result =
    out.spend !== null && out.conversions ? out.spend / out.conversions : null;
  return Object.assign(out, { _actions: actions });
}

export function stripSpend<T extends Metrics>(m: T, showSpend: boolean): T {
  if (showSpend) return m;
  const c = { ...m } as Metrics;
  for (const k of ["spend", "cpc", "cpm", "cost_per_result"]) c[k] = null;
  return c as T;
}
