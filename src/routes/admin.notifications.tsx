import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CenterLoader, ListSkeleton } from "@/components/ui/loader";
import { useEffect, useState } from "react";
import { adminT, useAdminT } from "@/hooks/use-admin-t";
import { Check, Inbox, ArrowRight } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { AppNotification } from "@/lib/notifications";

export const Route = createFileRoute("/admin/notifications")({
  component: AdminNotificationsPage,
  head: () => ({ meta: [{ title: adminT("notifications.pageTitle") }] }),
});

function AdminNotificationsPage() {
  const { user, loading: authLoading } = useAuth();
  const { t, locale } = useAdminT();
  const navigate = useNavigate();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    void load();
    const channel = supabase
      .channel(`admin-notifications-page-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user?.id]);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    setItems((data as AppNotification[]) ?? []);
    setLoading(false);
  }

  async function openNotification(n: AppNotification) {
    if (!n.read) {
      await supabase.from("notifications").update({ read: true }).eq("id", n.id);
      setItems((prev) => prev.map((p) => (p.id === n.id ? { ...p, read: true } : p)));
    }
    if (n.link) {
      const [path, hash] = n.link.split("#");
      navigate({ to: path as never, ...(hash ? { hash } : {}) });
    }
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

  if (authLoading || !user) return <CenterLoader className="h-96" />;
  const unread = items.some((n) => !n.read);

  return (
    <div className="container mx-auto max-w-4xl space-y-6 px-4 pb-28 pt-8 lg:pb-10">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-medium tracking-tight">
            {t("notifications.pageTitle")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {unread ? t("notifications.markAllRead") : t("notifications.allRead")}
          </p>
        </div>
        {unread && (
          <Button variant="outline" onClick={markAllRead}>
            <Check className="mr-2 h-4 w-4" />
            {t("notifications.markAllRead")}
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <ListSkeleton rows={4} />
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-3 p-12 text-center text-muted-foreground">
              <Inbox className="h-8 w-8" />
              {t("notifications.empty")}
            </div>
          ) : (
            items.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => openNotification(n)}
                className={`flex w-full items-start justify-between gap-4 border-b border-border/60 p-4 text-left transition hover:bg-secondary ${n.read ? "" : "bg-primary/5"}`}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{n.title}</p>
                    {!n.read && (
                      <Badge className="border-0 bg-primary/15 text-primary">
                        {t("common.new")}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{n.message}</p>
                  <p className="mt-1 text-xs text-muted-foreground/70">
                    {new Intl.DateTimeFormat(locale, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(n.created_at))}
                  </p>
                </div>
                {n.link && <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />}
              </button>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
