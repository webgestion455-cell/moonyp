/**
 * Meta Ads — fonctions serveur du back-office (lecture seule).
 * Consultation : permission « marketing.view » (admin + super admin).
 * Configuration : super administrateur uniquement.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }> };

async function assertMarketing(supabase: Rpc, userId: string) {
  const { data } = await supabase.rpc("has_permission", { _user_id: userId, _permission: "marketing.view" });
  if (data !== true) throw new Error("forbidden");
}
async function assertSuperAdmin(supabase: Rpc, userId: string) {
  const { data } = await supabase.rpc("is_super_admin", { _user_id: userId });
  if (data !== true) throw new Error("forbidden");
}

export const getMetaAdsStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertMarketing(context.supabase as never, context.userId);
    const m = await import("@/lib/meta-ads.server");
    const { data: sa } = await (context.supabase as unknown as Rpc).rpc("is_super_admin", { _user_id: context.userId });
    const missing = m.missingMetaEnv();
    const settings = await m.getMetaSettings();
    const runs = await m.lastRuns();
    const lastSuccess = runs.find((r) => r.status === "success" || r.status === "partial") ?? null;

    let token: Awaited<ReturnType<typeof m.debugToken>> | null = null;
    let tokenError: string | null = null;
    if (!missing.length) {
      try {
        token = await m.debugToken();
      } catch (e) {
        tokenError = e instanceof m.MetaApiError ? e.kind : "api_error";
      }
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: accounts } = await (supabaseAdmin as any)
      .from("meta_ads_accounts")
      .select("id, name, currency, account_status, timezone_name, last_synced_at")
      .order("name");

    return {
      is_super_admin: sa === true,
      configured: missing.length === 0,
      missing_secrets: missing,
      settings,
      token,
      token_error: tokenError,
      accounts: (accounts ?? []) as Array<{ id: string; name: string | null; currency: string | null; account_status: number | null; timezone_name: string | null; last_synced_at: string | null }>,
      runs,
      last_success_at: lastSuccess?.finished_at ?? null,
      interval_min: m.META_SYNC_INTERVAL_MIN,
    };
  });

export const syncMetaAdsNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ mode: z.enum(["manual", "auto"]) }).parse(i))
  .handler(async ({ data, context }) => {
    await assertMarketing(context.supabase as never, context.userId);
    const m = await import("@/lib/meta-ads.server");
    if (data.mode === "auto") {
      // Synchro automatique seulement si les données ont plus de 15 minutes.
      const runs = await m.lastRuns();
      const last = runs[0];
      if (last && Date.now() - new Date(last.started_at).getTime() < m.META_SYNC_INTERVAL_MIN * 60_000)
        return { status: "fresh" as const };
    }
    return m.runMetaSync(data.mode, context.userId);
  });

export const updateMetaAdsSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ enabled: z.boolean().optional(), show_spend: z.boolean().optional() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.supabase as never, context.userId);
    const m = await import("@/lib/meta-ads.server");
    const next = await m.saveMetaSettings(data, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await (supabaseAdmin as any).from("activity_logs").insert({
      actor_id: context.userId,
      action: "meta_ads_settings_updated",
      entity: "system_settings",
      metadata: next,
    });
    return next;
  });

const reportInput = z.object({
  account_id: z.string().max(40).optional(),
  campaign_id: z.string().max(40).optional(),
  preset: z.enum(["today", "last_7d", "last_30d", "this_month", "custom"]),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const getMetaAdsReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => reportInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertMarketing(context.supabase as never, context.userId);
    const m = await import("@/lib/meta-ads.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { show_spend } = await m.getMetaSettings();
    const clean = (x: ReturnType<typeof m.aggregate>) => {
      const { _actions, ...rest } = x;
      return { metrics: m.stripSpend(rest, show_spend), actions: _actions as Record<string, number> };
    };

    const scope = (q: any) => {
      if (data.account_id) q = q.eq("account_id", data.account_id);
      return q;
    };
    const { data: objects } = await scope(
      db.from("meta_ads_objects").select("id, level, account_id, campaign_id, adset_id, name, status, effective_status, objective, start_time, stop_time"),
    ).limit(5000);
    const objMap = new Map<string, any>((objects ?? []).map((o: any) => [o.id, o]));

    let range: { from: string | null; to: string | null } = { from: null, to: null };
    let summary: ReturnType<typeof clean> | null = null;
    const rowsByLevel: Record<string, Array<{ id: string; rows: any[]; official: boolean }>> = { campaign: [], adset: [], ad: [] };

    if (data.preset !== "custom") {
      const { data: period } = await scope(db.from("meta_ads_insights_period").select("*").eq("preset", data.preset)).limit(5000);
      const p = (period ?? []) as any[];
      const summaryRows = data.campaign_id
        ? p.filter((r) => r.level === "campaign" && r.object_id === data.campaign_id)
        : p.filter((r) => r.level === "account");
      summary = summaryRows.length ? clean(m.aggregate(summaryRows.map((r) => r.metrics), summaryRows.length === 1)) : null;
      const any = p[0];
      range = { from: any?.date_start ?? null, to: any?.date_stop ?? null };
      for (const lvl of ["campaign", "adset", "ad"] as const)
        rowsByLevel[lvl] = p
          .filter((r) => r.level === lvl && (!data.campaign_id || r.campaign_id === data.campaign_id))
          .map((r) => ({ id: r.object_id, rows: [r.metrics], official: true }));
    } else {
      if (!data.from || !data.to || data.from > data.to) throw new Error("invalid_range");
      range = { from: data.from, to: data.to };
    }

    // Série quotidienne (et agrégats d'une période personnalisée).
    let q = scope(db.from("meta_ads_insights_daily").select("level, object_id, date, campaign_id, metrics"));
    if (range.from) q = q.gte("date", range.from);
    if (range.to) q = q.lte("date", range.to);
    if (data.campaign_id) q = q.eq("campaign_id", data.campaign_id);
    const { data: daily } = await q.order("date").limit(20000);
    const d = (daily ?? []) as any[];

    const byDate = new Map<string, any[]>();
    for (const r of d.filter((r) => r.level === "campaign")) {
      byDate.set(r.date, [...(byDate.get(r.date) ?? []), r.metrics]);
    }
    const series = [...byDate.entries()].map(([date, rows]) => {
      const a = m.stripSpend(m.aggregate(rows), show_spend);
      return { date, impressions: a.impressions, clicks: a.clicks, inline_link_clicks: a.inline_link_clicks, conversions: a.conversions, spend: a.spend };
    });

    if (data.preset === "custom") {
      const camp = d.filter((r) => r.level === "campaign");
      summary = camp.length ? clean(m.aggregate(camp.map((r) => r.metrics))) : null;
      for (const lvl of ["campaign", "adset", "ad"] as const) {
        const g = new Map<string, any[]>();
        for (const r of d.filter((r) => r.level === lvl)) g.set(r.object_id, [...(g.get(r.object_id) ?? []), r.metrics]);
        rowsByLevel[lvl] = [...g.entries()].map(([id, rows]) => ({ id, rows, official: false }));
      }
    }

    const table = (lvl: "campaign" | "adset" | "ad") =>
      rowsByLevel[lvl].map(({ id, rows, official }) => {
        const o = objMap.get(id) ?? {};
        return {
          id,
          name: o.name ?? id,
          status: o.effective_status ?? o.status ?? null,
          objective: o.objective ?? null,
          campaign_id: o.campaign_id ?? null,
          adset_id: o.adset_id ?? null,
          start_time: o.start_time ?? null,
          stop_time: o.stop_time ?? null,
          ...clean(m.aggregate(rows, official && rows.length === 1)),
        };
      });

    const campaigns = (objects ?? [])
      .filter((o: any) => o.level === "campaign")
      .map((o: any) => ({ id: o.id, name: o.name, account_id: o.account_id }));

    return {
      show_spend,
      range,
      summary,
      series,
      campaigns,
      levels: { campaign: table("campaign"), adset: table("adset"), ad: table("ad") },
      has_any_data: (objects ?? []).length > 0,
    };
  });
