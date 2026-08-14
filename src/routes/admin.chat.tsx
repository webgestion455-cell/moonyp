import { createFileRoute, Link, Outlet, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { formatDay } from "@/components/chat/chat-helpers";
import { Search, Folder, MessageCircle, User } from "lucide-react";

export const Route = createFileRoute("/admin/chat")({
  component: AdminChatLayout,
  head: () => ({ meta: [{ title: "Admin — Live Chat BNP PARIBAS" }] }),
});

interface Folder {
  folder_key: string;
  user_id: string | null;
  is_guest: boolean;
  folder_name: string;
  folder_email: string | null;
  open_count: number;
  closed_count: number;
  last_activity: string;
  unread_total: number;
}

interface Ticket {
  id: string;
  ticket_number: string | null;
  user_id: string | null;
  is_guest: boolean;
  guest_name: string | null;
  guest_email: string | null;
  status: string;
  subject: string;
  last_message_at: string;
  unread_agent: number;
  assigned_agent_name: string | null;
  priority: string | null;
}

function AdminChatLayout() {
  const { t, i18n } = useTranslation();
  const params = useParams({ strict: false }) as { conversationId?: string };
  const [folders, setFolders] = useState<Folder[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "waiting" | "closed" | "guests">("all");
  const [search, setSearch] = useState("");

  // Load folders
  useEffect(() => {
    const load = async () => {
      const { data } = await (supabase as any)
        .from("chat_admin_folders")
        .select("*")
        .order("last_activity", { ascending: false });
      setFolders((data as Folder[]) ?? []);
    };
    load();
    const chan = supabase
      .channel("admin-chat-folders")
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_conversations" }, () => load())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(chan);
    };
  }, []);

  // Load tickets for selected folder
  useEffect(() => {
    if (!selectedFolder) {
      setTickets([]);
      return;
    }
    const load = async () => {
      let q = (supabase as any).from("chat_conversations").select("*");
      const [type, id] = selectedFolder.split(":");
      if (type === "guest") q = q.eq("id", id);
      else q = q.eq("user_id", selectedFolder);
      const { data } = await q.order("last_message_at", { ascending: false });
      setTickets((data as Ticket[]) ?? []);
    };
    load();
  }, [selectedFolder, filter]);

  const filteredFolders = useMemo(() => {
    let list = folders;
    if (filter === "guests") list = list.filter((f) => f.is_guest);
    if (filter === "waiting") list = list.filter((f) => f.open_count > 0);
    if (filter === "closed") list = list.filter((f) => f.open_count === 0 && f.closed_count > 0);
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(
        (f) =>
          f.folder_name.toLowerCase().includes(s) ||
          (f.folder_email ?? "").toLowerCase().includes(s),
      );
    }
    return list;
  }, [folders, filter, search]);

  const filteredTickets = useMemo(() => {
    if (filter === "closed") return tickets.filter((t) => t.status === "closed");
    if (filter === "waiting") return tickets.filter((t) => t.status !== "closed");
    return tickets;
  }, [tickets, filter]);

  const active = params.conversationId;

  return (
    <div className="p-3 sm:p-4 lg:p-6 h-[calc(100dvh-3.5rem)] min-h-0">
      <div className="grid gap-3 sm:gap-4 h-full min-h-0 grid-cols-1 lg:grid-cols-[280px_320px_minmax(0,1fr)]">
        {/* SIDEBAR — dossiers clients */}
        <aside
          className={cn(
            "rounded-2xl border border-border bg-card flex-col overflow-hidden min-h-0",
            active || selectedFolder ? "hidden lg:flex" : "flex",
          )}
        >
          <div className="p-3 border-b border-border space-y-2">

            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Folder className="h-3.5 w-3.5" />
              {t("chat.admin.folders")}
            </div>
            <div className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2 py-1">
              <Search className="h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher…"
                className="bg-transparent text-xs outline-none flex-1"
              />
            </div>
            <div className="flex flex-wrap gap-1">
              {(["all", "waiting", "closed", "guests"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setFilter(k)}
                  className={cn(
                    "text-[11px] px-2 py-1 rounded-full border",
                    filter === k ? "bg-[#00915A] text-white border-[#00915A]" : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  {t(`chat.admin.filter.${k}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {filteredFolders.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">{t("chat.admin.empty") ?? "Aucun dossier"}</p>
            )}
            {filteredFolders.map((f) => (
              <button
                key={f.folder_key}
                onClick={() => setSelectedFolder(f.folder_key)}
                className={cn(
                  "w-full text-left px-3 py-2.5 border-b border-border text-sm hover:bg-muted transition flex gap-2 items-start",
                  selectedFolder === f.folder_key && "bg-muted",
                )}
              >
                <div className={cn(
                  "h-8 w-8 rounded-full grid place-items-center shrink-0 text-white text-xs font-bold",
                  f.is_guest ? "bg-amber-500" : "bg-[#00915A]",
                )}>
                  {f.folder_name.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{f.folder_name}</span>
                    {f.unread_total > 0 && (
                      <Badge className="bg-red-500 text-white text-[10px]">{f.unread_total}</Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">{f.folder_email ?? (f.is_guest ? "Visiteur" : "—")}</p>
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                    <span>{f.open_count} ouv.</span>
                    <span>·</span>
                    <span>{f.closed_count} clos</span>
                    <span className="ml-auto">{formatDay(f.last_activity, t as any, i18n.language)}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </aside>

        {/* TICKETS du dossier */}
        <aside
          className={cn(
            "rounded-2xl border border-border bg-card flex-col overflow-hidden min-h-0",
            active ? "hidden lg:flex" : selectedFolder ? "flex" : "hidden lg:flex",
          )}
        >
          <div className="p-3 border-b border-border flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <MessageCircle className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{t("chat.admin.tickets")}</span>
            {selectedFolder && (
              <button
                onClick={() => setSelectedFolder(null)}
                className="lg:hidden ml-auto rounded-full border border-border px-2 py-0.5 text-[10px] normal-case tracking-normal"
              >
                {t("chat.tickets.back")}
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {!selectedFolder && (
              <p className="p-4 text-sm text-muted-foreground text-center">
                {t("chat.admin.selectHint")}
              </p>
            )}
            {filteredTickets.map((tk) => (
              <Link
                key={tk.id}
                to="/admin/chat/$conversationId"
                params={{ conversationId: tk.id }}
                className={cn(
                  "block px-3 py-2.5 border-b border-border text-sm hover:bg-muted transition",
                  active === tk.id && "bg-muted",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] text-primary">#{tk.ticket_number ?? "—"}</span>
                  <span className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded-full",
                    tk.status === "closed" ? "bg-muted text-muted-foreground" :
                    tk.status === "waiting_agent" ? "bg-amber-500/20 text-amber-700 dark:text-amber-300" :
                    tk.status === "assigned" ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300" :
                    "bg-blue-500/20 text-blue-700 dark:text-blue-300"
                  )}>
                    {t(`chat.status.${tk.status}`)}
                  </span>
                </div>
                <p className="font-medium truncate mt-0.5">{tk.subject}</p>
                {tk.unread_agent > 0 && (
                  <Badge className="bg-red-500 text-white text-[10px] mt-1">{tk.unread_agent}</Badge>
                )}
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {formatDay(tk.last_message_at, t as any, i18n.language)}
                </p>
              </Link>
            ))}
          </div>
        </aside>

        {/* CONVERSATION */}
        <section className={cn("min-h-0 min-w-0", active ? "block" : "hidden lg:block")}>
          {active && (
            <Link
              to="/admin/chat"
              className="lg:hidden mb-2 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              ← {t("chat.tickets.back")}
            </Link>
          )}
          <Outlet />
        </section>

      </div>
    </div>
  );
}
