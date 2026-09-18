import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Bell, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ensureBrowserPermission,
  showBrowserNotification,
  playNotificationSound,
  type AppNotification,
} from "@/lib/notifications";
import { subscribeToPush } from "@/lib/push";
import { formatDistanceToNow } from "date-fns";
import { fr, enUS, de, es, sl, bg, sk } from "date-fns/locale";
import type { Locale } from "date-fns";

const LOCALES: Record<string, Locale> = { fr, en: enUS, de, es, sl, bg, sk };

export function NotificationBell() {
  const { user, role } = useAuth();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const dateLocale = LOCALES[i18n.resolvedLanguage ?? "fr"] ?? fr;

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    if (!user) return;
    void ensureBrowserPermission().then((p) => {
      if (p === "granted") void subscribeToPush(user.id).catch(() => {});
    });
    void load();

    // Unique per-mount channel name to avoid re-subscribing the same channel
    // after React StrictMode double-invokes the effect (which caused
    // "cannot add postgres_changes callbacks ... after subscribe()").
    const channelName = `notif-${user.id}-${Math.random().toString(36).slice(2, 8)}`;
    const channel = supabase.channel(channelName);
    channelRef.current = channel;

    channel
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const n = payload.new as AppNotification;
          setItems((prev) => {
            if (prev.some((p) => p.id === n.id)) return prev;
            return [n, ...prev].slice(0, 50);
          });
          playNotificationSound();
          showBrowserNotification(n);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const n = payload.new as AppNotification;
          setItems((prev) => prev.map((p) => (p.id === n.id ? n : p)));
        },
      )
      .subscribe();

    return () => {
      const ch = channelRef.current;
      channelRef.current = null;
      if (ch) void supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function load() {
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30);
    if (data) setItems(data as AppNotification[]);
  }

  async function markAllRead() {
    if (!user) return;
    await supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", user.id)
      .eq("read", false);
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
  }

  if (!user) return null;
  const unread = items.filter((n) => !n.read).length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("notifications.title")}
          className="relative h-9 w-9"
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,22rem)] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-semibold">{t("notifications.title")}</span>
          {unread > 0 && (
            <button
              onClick={markAllRead}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <Check className="h-3.5 w-3.5" /> {t("notifications.markAllRead")}
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {items.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              {t("notifications.empty")}
            </div>
          ) : (
            items.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={async () => {
                  setOpen(false);

                  if (!n.read) {
                    await supabase.from("notifications").update({ read: true }).eq("id", n.id);

                    setItems((prev) => prev.map((p) => (p.id === n.id ? { ...p, read: true } : p)));
                  }

                  if (n.link) {
                    // Le lien peut cibler une section précise (…/applications/x#documents).
                    const [path, hash] = n.link.split("#");
                    navigate({ to: path as never, ...(hash ? { hash } : {}) });
                  }
                }}
                className={`block w-full text-left border-b border-border/50 px-4 py-3 text-sm transition-colors hover:bg-secondary ${
                  n.read ? "" : "bg-primary/5"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">{n.title}</span>
                  {!n.read && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />}
                </div>

                <p className="mt-0.5 text-xs text-muted-foreground">{n.message}</p>

                <p className="mt-1 text-[10px] text-muted-foreground">
                  {formatDistanceToNow(new Date(n.created_at), {
                    addSuffix: true,
                    locale: dateLocale,
                  })}
                </p>
              </button>
            ))
          )}
        </div>
        <div className="border-t border-border px-4 py-3">
          <Link
            to="/admin/notifications"
            onClick={() => setOpen(false)}
            className="block text-center text-xs font-medium text-primary hover:underline"
          >
            {t("notifications.viewAll")}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
