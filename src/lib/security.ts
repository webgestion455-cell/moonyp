// Lightweight bank-grade client security toolkit.
// Device fingerprinting (no external dep), event logging, behavior tracking,
// risk-score evaluation. Server enforcement uses RLS + has_role.

import { supabase as _sb } from "@/integrations/supabase/client";
// Table type widening: local supabase types are regenerated post-migration; cast for now.
const supabase: any = _sb;

const FP_KEY = "bn.dev.fp";
const SESSION_START_KEY = "bnpparibas.sec.session_start";

// ---------- Fingerprinting ----------
function detectBrowser(ua: string): string {
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\//.test(ua)) return "Opera";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua)) return "Safari";
  return "Unknown";
}

function detectOS(ua: string): string {
  if (/Windows/.test(ua)) return "Windows";
  if (/Android/.test(ua)) return "Android";
  if (/iPhone|iPad|iOS/.test(ua)) return "iOS";
  if (/Mac OS X/.test(ua)) return "macOS";
  if (/Linux/.test(ua)) return "Linux";
  return "Unknown";
}

async function sha256(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface DeviceInfo {
  fingerprint: string;
  browser: string;
  os: string;
  userAgent: string;
}

export async function getDeviceInfo(): Promise<DeviceInfo> {
  if (typeof window === "undefined") {
    return { fingerprint: "ssr", browser: "Unknown", os: "Unknown", userAgent: "" };
  }
  const ua = navigator.userAgent || "";
  const browser = detectBrowser(ua);
  const os = detectOS(ua);

  let cached = "";
  try {
    cached = localStorage.getItem(FP_KEY) || "";
  } catch {}

  if (!cached) {
    const screenRes = `${window.screen.width}x${window.screen.height}x${window.screen.colorDepth}`;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    const lang = navigator.language || "";
    const hw = `${navigator.hardwareConcurrency || 0}c/${(navigator as Navigator & { deviceMemory?: number }).deviceMemory || 0}g`;
    const raw = [ua, screenRes, tz, lang, hw].join("|");
    cached = await sha256(raw);
    try {
      localStorage.setItem(FP_KEY, cached);
    } catch {}
  }
  return { fingerprint: cached, browser, os, userAgent: ua };
}

// ---------- Geolocation (best-effort, free public API) ----------
let cachedIp: { ip: string; country: string } | null = null;
export async function getIpInfo(): Promise<{ ip: string; country: string }> {
  if (cachedIp) return cachedIp;
  try {
    const res = await fetch("https://ipapi.co/json/", { signal: AbortSignal.timeout(3500) });
    if (!res.ok) throw new Error("ip lookup failed");
    const data = await res.json();
    cachedIp = { ip: data.ip || "", country: data.country_name || data.country || "" };
    return cachedIp;
  } catch {
    return { ip: "", country: "" };
  }
}

// ---------- Logging ----------
export type SecurityAction =
  | "login_success"
  | "login_failure"
  | "logout"
  | "signup"
  | "password_reset_request"
  | "password_changed"
  | "profile_updated"
  | "loan_request"
  | "transfer_initiated"
  | "withdrawal_requested"
  | "sensitive_view"
  | "settings_changed"
  | "device_trusted"
  | "anomaly_detected";

export async function logSecurityEvent(
  action: SecurityAction,
  opts: { userId?: string | null; success?: boolean; metadata?: Record<string, unknown> } = {}
): Promise<void> {
  try {
    const [device, ip] = await Promise.all([getDeviceInfo(), getIpInfo()]);
    await supabase.from("security_logs").insert({
      user_id: opts.userId ?? null,
      action,
      success: opts.success ?? true,
      device_fingerprint: device.fingerprint,
      browser: device.browser,
      os: device.os,
      user_agent: device.userAgent,
      ip_address: ip.ip || null,
      country: ip.country || null,
      metadata: (opts.metadata ?? {}) as never,
    });
  } catch (e) {
    console.warn("[security] log failed", e);
  }
}

// ---------- Device trust ----------
export interface DeviceCheckResult {
  isNew: boolean;
  isNewCountry: boolean;
  device: DeviceInfo;
  country: string;
}

export async function checkAndRegisterDevice(userId: string): Promise<DeviceCheckResult> {
  const [device, ip] = await Promise.all([getDeviceInfo(), getIpInfo()]);
  const { data: existing } = await supabase
    .from("trusted_devices")
    .select("id, country, trusted")
    .eq("user_id", userId)
    .eq("fingerprint", device.fingerprint)
    .maybeSingle();

  let isNew = false;
  let isNewCountry = false;

  if (!existing) {
    isNew = true;
    await supabase.from("trusted_devices").insert({
      user_id: userId,
      fingerprint: device.fingerprint,
      browser: device.browser,
      os: device.os,
      ip_address: ip.ip || null,
      country: ip.country || null,
      label: `${device.browser} · ${device.os}`,
      trusted: false,
    });
  } else {
    isNewCountry = !!(ip.country && existing.country && ip.country !== existing.country);
    await supabase
      .from("trusted_devices")
      .update({
        last_seen_at: new Date().toISOString(),
        ip_address: ip.ip || null,
        country: ip.country || existing.country,
      })
      .eq("id", existing.id);
  }
  return { isNew, isNewCountry, device, country: ip.country };
}

export async function markDeviceTrusted(userId: string): Promise<void> {
  const device = await getDeviceInfo();
  await supabase
    .from("trusted_devices")
    .update({ trusted: true })
    .eq("user_id", userId)
    .eq("fingerprint", device.fingerprint);
  await logSecurityEvent("device_trusted", { userId });
}

// ---------- Risk scoring ----------
export interface RiskFactors {
  newDevice?: boolean;
  newCountry?: boolean;
  failedLogins?: number;
  rapidActions?: boolean;
}

export function computeRiskDelta(f: RiskFactors): number {
  let d = 0;
  if (f.newDevice) d += 25;
  if (f.newCountry) d += 30;
  if (f.failedLogins && f.failedLogins > 2) d += Math.min(40, f.failedLogins * 10);
  if (f.rapidActions) d += 15;
  return d;
}

export async function updateRiskScore(userId: string, factors: RiskFactors): Promise<number> {
  const delta = computeRiskDelta(factors);
  const { data: row } = await supabase
    .from("user_behavior")
    .select("risk_score")
    .eq("user_id", userId)
    .maybeSingle();
  const current = row?.risk_score ?? 0;
  const decayed = Math.max(0, current - 2); // gentle decay each evaluation
  const next = Math.min(100, decayed + delta);

  if (row) {
    await supabase.from("user_behavior").update({ risk_score: next }).eq("user_id", userId);
  } else {
    await supabase.from("user_behavior").insert({ user_id: userId, risk_score: next });
  }
  if (next >= 60) {
    await supabase.from("security_alerts").insert({
      user_id: userId,
      alert_type: "high_risk_score",
      severity: next >= 80 ? "high" : "medium",
      description: `Risk score reached ${next}`,
      metadata: factors as never,
    });
  }
  return next;
}

// ---------- Behavior tracking ----------
export function startSessionTimer(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(SESSION_START_KEY, Date.now().toString());
  } catch {}
}

export async function endSessionTimer(userId: string): Promise<void> {
  if (typeof window === "undefined" || !userId) return;
  try {
    const start = parseInt(sessionStorage.getItem(SESSION_START_KEY) || "0", 10);
    if (!start) return;
    const seconds = Math.max(0, Math.floor((Date.now() - start) / 1000));
    sessionStorage.removeItem(SESSION_START_KEY);
    const { data: row } = await supabase
      .from("user_behavior")
      .select("session_count,total_session_seconds")
      .eq("user_id", userId)
      .maybeSingle();
    if (row) {
      await supabase
        .from("user_behavior")
        .update({
          session_count: (row.session_count ?? 0) + 1,
          total_session_seconds: (row.total_session_seconds ?? 0) + seconds,
        })
        .eq("user_id", userId);
    } else {
      await supabase.from("user_behavior").insert({
        user_id: userId,
        session_count: 1,
        total_session_seconds: seconds,
      });
    }
  } catch (e) {
    console.warn("[security] session timer end failed", e);
  }
}

export async function trackSensitiveAction(userId: string): Promise<void> {
  try {
    const now = new Date().toISOString();
    const { data: row } = await supabase
      .from("user_behavior")
      .select("sensitive_action_count,last_sensitive_action_at")
      .eq("user_id", userId)
      .maybeSingle();
    const rapid =
      row?.last_sensitive_action_at &&
      Date.now() - new Date(row.last_sensitive_action_at).getTime() < 1500;
    if (row) {
      await supabase
        .from("user_behavior")
        .update({
          sensitive_action_count: (row.sensitive_action_count ?? 0) + 1,
          last_sensitive_action_at: now,
        })
        .eq("user_id", userId);
    } else {
      await supabase.from("user_behavior").insert({
        user_id: userId,
        sensitive_action_count: 1,
        last_sensitive_action_at: now,
      });
    }
    if (rapid) await updateRiskScore(userId, { rapidActions: true });
  } catch (e) {
    console.warn("[security] track sensitive failed", e);
  }
}
