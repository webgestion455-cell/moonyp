// Client-side helpers for Web Push subscription.
import { supabase } from "@/integrations/supabase/client";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}

export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  // Avoid registering when in iframe / preview hosts (per Lovable guidance)
  const inIframe = (() => { try { return window.self !== window.top; } catch { return true; } })();
  const isPreview = window.location.hostname.includes("lovableproject.com") || window.location.hostname.includes("id-preview--");
  if (inIframe || isPreview) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch {
    return null;
  }
}

export async function subscribeToPush(userId: string): Promise<boolean> {
  if (!VAPID_PUBLIC_KEY) return false;
  if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) return false;
  if (Notification.permission === "denied") return false;

  // Ensure the current session actually matches the userId — avoids the
  // 403 Forbidden upsert observed when the RLS check auth.uid() = user_id
  // runs while the client has no valid session (or a stale one).
  const { data: authData } = await supabase.auth.getUser();
  if (!authData?.user || authData.user.id !== userId) return false;

  if (Notification.permission !== "granted") {
    const p = await Notification.requestPermission();
    if (p !== "granted") return false;
  }
  const reg = await ensureServiceWorker();
  if (!reg) return false;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    } catch {
      return false;
    }
  }
  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;

  const { error } = await (supabase as any).from("push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_agent: navigator.userAgent,
    },
    { onConflict: "endpoint" },
  );
  if (error) {
    // Swallow — a missing RLS grant should never crash the notification bell.
    // Log softly so it's visible in dev tools.
    console.warn("[push] upsert failed:", error.message);
    return false;
  }
  return true;
}
