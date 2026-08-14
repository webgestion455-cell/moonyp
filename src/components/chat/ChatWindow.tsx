import { useEffect, useRef, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Send, X, Bold, Italic, Link2, Loader2, Check, ArrowRight, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  CHAT_BRAND,
  sanitizeHtml,
  textToHtml,
  formatTime,
  formatDay,
  initials,
} from "./chat-helpers";

// ------------------ Types ------------------
export interface ChatConversation {
  id: string;
  user_id: string;
  status: "open" | "waiting_agent" | "assigned" | "closed";
  assigned_agent_id: string | null;
  assigned_agent_name: string | null;
  subject: string;
  last_message_at: string;
  unread_client: number;
  unread_agent: number;
  created_at: string;
  closed_at: string | null;
  ticket_number?: string | null;
  is_guest?: boolean;
  guest_name?: string | null;
  guest_email?: string | null;
  guest_phone?: string | null;
  guest_whatsapp?: string | null;
  guest_country?: string | null;
  priority?: string | null;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_type: "client" | "bot" | "agent" | "system";
  sender_id: string | null;
  sender_name: string | null;
  content_html: string;
  content_text: string | null;
  format: string;
  created_at: string;
  meta?: unknown;
}

/** Texte de bienvenue localisé (utilisé à la création d'une conversation). */
export interface WelcomeCopy {
  greeting: string;
  help: string;
}

// ------------------ Ensure/find conversation ------------------
export async function ensureConversation(
  userId: string,
  welcome?: WelcomeCopy,
  forceNew = false,
): Promise<ChatConversation> {
  if (!forceNew) {
    // Cherche une conversation ouverte existante
    const { data: existing } = await (supabase as any)
      .from("chat_conversations")
      .select("*")
      .eq("user_id", userId)
      .neq("status", "closed")
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) return existing as ChatConversation;
  }

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { data: created, error } = await (supabase as any)
    .from("chat_conversations")
    .insert({ user_id: userId, subject: "Assistance", timezone: tz })
    .select("*")
    .single();
  if (error) throw error;

  // Message de bienvenue — toujours dans la langue de l'utilisateur
  const greeting = welcome?.greeting ?? "Hello, I'm Anna.";
  const help = welcome?.help ?? "";
  await (supabase as any).from("chat_messages").insert({
    conversation_id: (created as any).id,
    sender_type: "bot",
    sender_name: "Anna",
    format: "html",
    content_html: `<p>${escapeHtml(greeting)}</p>${help ? `<p>${escapeHtml(help)}</p>` : ""}`,
    content_text: `${greeting} ${help}`.trim(),
  });
  return created as ChatConversation;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}


// ------------------ Composant ------------------
interface ChatWindowProps {
  conversationId: string;
  mode: "client" | "agent";
  guestMode?: boolean;
  onClose?: () => void;
  onCloseTicket?: () => void;
  className?: string;
  showHeader?: boolean;
}

export function ChatWindow({
  conversationId,
  mode,
  guestMode = false,
  onClose,
  onCloseTicket,
  className,
  showHeader = true,
}: ChatWindowProps) {
  const { t, i18n } = useTranslation();
  const { user, profile } = useAuth() as any;
  const [conv, setConv] = useState<ChatConversation | null>(null);
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [aiTyping, setAiTyping] = useState(false);
  const [pendingHandoff, setPendingHandoff] = useState(false);
  const [clock, setClock] = useState<string>("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Horloge live (locale)
  useEffect(() => {
    const tick = () =>
      setClock(
        new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit" }).format(
          new Date(),
        ),
      );
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [i18n.language]);

  // Chargement + realtime
  useEffect(() => {
    if (!conversationId) return;
    let alive = true;

    (async () => {
      const { data: c } = await (supabase as any)
        .from("chat_conversations")
        .select("*")
        .eq("id", conversationId)
        .maybeSingle();
      if (alive && c) setConv(c as ChatConversation);

      const { data: m } = await (supabase as any)
        .from("chat_messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });
      if (alive && m) setMsgs(m as ChatMessage[]);
    })();

    const chan = supabase
      .channel(`chat:${conversationId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          setMsgs((prev) => {
            const next = payload.new as ChatMessage;
            if (prev.find((m) => m.id === next.id)) return prev;
            return [...prev, next];
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chat_conversations", filter: `id=eq.${conversationId}` },
        (payload) => setConv(payload.new as ChatConversation),
      )
      .subscribe();

    return () => {
      alive = false;
      supabase.removeChannel(chan);
    };
  }, [conversationId]);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs.length, aiTyping]);

  // Envoi message
  const sendMessage = useCallback(
    async (html: string, format: "html" | "text" = "html") => {
      if (!conversationId) return;
      const cleaned = sanitizeHtml(html).trim();
      if (!cleaned || cleaned === "<p></p>") return;
      setSending(true);
      try {
        // GUEST : passe par edge function (RLS refuse l'insert direct)
        if (guestMode) {
          const plain = cleaned.replace(/<[^>]+>/g, " ").trim();
          setAiTyping(true);
          const { error } = await supabase.functions.invoke("chat-guest-post", {
            body: { conversationId, message: plain, lang: i18n.language },
          });
          setAiTyping(false);
          if (error) throw error;
          return;
        }

        if (!user) return;
        const senderName =
          mode === "agent"
            ? (profile?.full_name ?? "Conseiller BNP")
            : (profile?.full_name ?? user.email ?? "Client");
        const { error } = await (supabase as any).from("chat_messages").insert({
          conversation_id: conversationId,
          sender_type: mode === "agent" ? "agent" : "client",
          sender_id: user.id,
          sender_name: senderName,
          format,
          content_html: cleaned,
          content_text: cleaned.replace(/<[^>]+>/g, " "),
        });
        if (error) throw error;

        // Si client authentifié : demander à l'IA (sauf si un agent a rejoint)
        if (mode === "client" && conv?.status !== "assigned") {
          setAiTyping(true);
          try {
            const history = msgs.slice(-8).map((m) => ({
              role: m.sender_type === "client" ? "user" : "assistant",
              content: (m.content_text ?? m.content_html.replace(/<[^>]+>/g, " ")).trim(),
            }));
            const { data, error: fnErr } = await supabase.functions.invoke("chat-ai", {
              body: {
                message: cleaned.replace(/<[^>]+>/g, " ").trim(),
                history,
                lang: i18n.language,
              },
            });
            if (fnErr) throw fnErr;
            const html = String((data as any)?.html ?? "");
            const handoff = Boolean((data as any)?.handoff);
            await (supabase as any).from("chat_messages").insert({
              conversation_id: conversationId,
              sender_type: "bot",
              sender_name: "Anna",
              format: "html",
              content_html: html,
              content_text: html.replace(/<[^>]+>/g, " "),
              meta: handoff ? { handoff: true } : null,
            });
            if (handoff) setPendingHandoff(true);
          } catch (e) {
            console.error(e);
          } finally {
            setAiTyping(false);
          }
        }
      } catch (e: any) {
        toast.error(e?.message ?? "Erreur d'envoi");
      } finally {
        setSending(false);
      }
    },
    [user, conversationId, mode, guestMode, profile, conv?.status, msgs, i18n.language],
  );

  // Handoff : oui → edge function
  const confirmHandoff = useCallback(async () => {
    if (!conversationId) return;
    setPendingHandoff(false);
    try {
      await supabase.functions.invoke("chat-handoff", {
        body: {
          conversationId,
          userEmail: user?.email,
          userName: profile?.full_name,
        },
      });
      toast.success(t("chat.handoff.pending"));
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur");
    }
  }, [conversationId, user, profile, t]);

  // Agent : rejoindre la conversation
  const joinAsAgent = useCallback(async () => {
    if (!user || !conv) return;
    const agentName = profile?.full_name ?? user.email ?? "Conseiller";
    await (supabase as any)
      .from("chat_conversations")
      .update({
        status: "assigned",
        assigned_agent_id: user.id,
        assigned_agent_name: agentName,
      })
      .eq("id", conv.id);
    await (supabase as any).from("chat_messages").insert({
      conversation_id: conv.id,
      sender_type: "system",
      sender_name: "Système",
      format: "html",
      content_html: `<p><em>${agentName} ${t("chat.agent.joined")}</em></p>`,
      content_text: `${agentName} a rejoint la conversation.`,
    });
    toast.success(t("chat.agent.joinedYou"));
  }, [user, conv, profile, t]);

  // Fermer / rouvrir le ticket (client ET agent)
  const closeTicket = useCallback(async () => {
    if (!conversationId) return;
    await (supabase as any)
      .from("chat_conversations")
      .update({
        status: "closed",
        closed_at: new Date().toISOString(),
        ...(user ? { closed_by: user.id } : {}),
      })
      .eq("id", conversationId);
    await (supabase as any).from("chat_messages").insert({
      conversation_id: conversationId,
      sender_type: "system",
      sender_name: "Système",
      format: "html",
      content_html: `<p><em>${t("chat.closed")}</em></p>`,
      content_text: "Conversation fermée.",
    });
    toast.success(t("chat.closed"));
    onCloseTicket?.();
  }, [conversationId, onCloseTicket, t, user]);

  const reopenTicket = useCallback(async () => {
    if (!conversationId) return;
    await (supabase as any)
      .from("chat_conversations")
      .update({ status: "open", closed_at: null })
      .eq("id", conversationId);
    toast.success(t("chat.admin.updated"));
  }, [conversationId, t]);

  const isClosed = conv?.status === "closed";
  const agentJoined = conv?.status === "assigned" && conv?.assigned_agent_name;

  // Regroupement par jour
  const grouped: { day: string; items: ChatMessage[] }[] = [];
  for (const m of msgs) {
    const day = formatDay(m.created_at, t as any, i18n.language);
    const last = grouped[grouped.length - 1];
    if (last && last.day === day) last.items.push(m);
    else grouped.push({ day, items: [m] });
  }

  return (
    <div
      className={cn(
        "flex flex-col h-full min-h-0 min-w-0 bg-background text-foreground border border-border rounded-2xl overflow-hidden shadow-elevated",
        className,
      )}
    >
      {/* Header BNP PARIBAS */}
      {showHeader && (
        <header className="bg-[#00915A] text-white px-3 sm:px-4 py-2.5 sm:py-3 flex items-center gap-2 sm:gap-3">
          <BankLogo className="h-7 w-7 sm:h-8 sm:w-8 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <p className="font-bold tracking-wide truncate text-sm sm:text-base">
                {CHAT_BRAND.bankName}
              </p>
              {agentJoined ? (
                <span className="hidden sm:inline text-[10px] bg-white/20 px-1.5 py-0.5 rounded-full truncate max-w-[140px]">
                  {conv?.assigned_agent_name}
                </span>
              ) : null}
            </div>
            <p className="text-[11px] opacity-90 flex items-center gap-1.5 truncate">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-300 animate-pulse shrink-0" />
              <span className="truncate">
                {agentJoined ? t("chat.status.agent") : t("chat.status.online")}
              </span>
              <span className="opacity-70 shrink-0">· {clock}</span>
            </p>
          </div>
          {conv?.ticket_number && (
            <span className="hidden md:inline font-mono text-[10px] bg-white/15 px-2 py-1 rounded-md shrink-0">
              #{conv.ticket_number}
            </span>
          )}
          {!isClosed ? (
            <button
              onClick={closeTicket}
              className="shrink-0 rounded-full bg-white/15 hover:bg-white/25 px-2.5 py-1 text-[11px] font-medium transition"
            >
              {mode === "agent" ? t("chat.admin.close") : t("chat.closeTicket")}
            </button>
          ) : mode === "agent" ? (
            <button
              onClick={reopenTicket}
              className="shrink-0 rounded-full bg-white/15 hover:bg-white/25 px-2.5 py-1 text-[11px] font-medium transition"
            >
              {t("chat.admin.reopen")}
            </button>
          ) : null}
          {onClose && (
            <button onClick={onClose} aria-label={t("chat.close")} className="shrink-0">
              <X className="h-5 w-5" />
            </button>
          )}
        </header>
      )}

      {/* Fiche ticket (agent) — toutes les informations transmises par le visiteur */}
      {mode === "agent" && conv && <TicketInfo conv={conv} />}

      {/* Bandeau signature de tête (branding) */}
      <BrandBanner position="top" />


      {/* Corps */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3 bg-muted/30">
        {grouped.map((group, gi) => (
          <div key={gi} className="space-y-2">
            <div className="text-center text-[10px] uppercase tracking-wider text-muted-foreground">
              {group.day}
            </div>
            {group.items.map((m) => (
              <MessageBubble key={m.id} m={m} mode={mode} />
            ))}
          </div>
        ))}

        {aiTyping && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce" />
              <span
                className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce"
                style={{ animationDelay: "120ms" }}
              />
              <span
                className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce"
                style={{ animationDelay: "240ms" }}
              />
            </span>
            Anna {t("chat.typing")}…
          </div>
        )}

        {pendingHandoff && mode === "client" && !agentJoined && (
          <div className="rounded-2xl border border-primary/30 bg-primary/5 p-3 text-sm">
            <p className="mb-2 font-medium">{t("chat.handoff.question")}</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={confirmHandoff}>
                <Check className="h-3.5 w-3.5 mr-1" /> {t("chat.handoff.yes")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setPendingHandoff(false)}>
                {t("chat.handoff.no")}
              </Button>
            </div>
          </div>
        )}

        {conv?.status === "waiting_agent" && (
          <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-200 text-xs p-2 text-center">
            {t("chat.handoff.pending")}
          </div>
        )}

        {isClosed && (
          <div className="rounded-xl bg-muted text-muted-foreground text-xs p-2 text-center">
            {t("chat.closed")}
          </div>
        )}
      </div>

      {/* Bandeau signature de pied */}
      <BrandBanner position="bottom" />

      {/* Composer */}
      {!isClosed && (
        <div className="border-t border-border bg-card">
          {mode === "agent" && conv?.status !== "assigned" && (
            <div className="px-3 py-2 border-b border-border flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{t("chat.agent.notAssigned")}</span>
              <Button size="sm" onClick={joinAsAgent}>
                <ArrowRight className="h-3.5 w-3.5 mr-1" />
                {t("chat.agent.join")}
              </Button>
            </div>
          )}
          <RichComposer disabled={sending} onSend={sendMessage} />
        </div>
      )}
    </div>
  );
}

// ------------------ Fiche ticket (côté agent) ------------------
function TicketInfo({ conv }: { conv: ChatConversation }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(true);

  const rows: { label: string; value?: string | null }[] = [
    { label: t("chat.ticket"), value: conv.ticket_number ? `#${conv.ticket_number}` : null },
    { label: t("chat.guest.subject").replace(" *", ""), value: conv.subject },
    { label: t("chat.guest.name").replace(" *", ""), value: conv.guest_name },
    { label: t("chat.guest.email").replace(" *", ""), value: conv.guest_email },
    { label: t("chat.guest.phone"), value: conv.guest_phone },
    { label: t("chat.guest.whatsapp"), value: conv.guest_whatsapp },
    { label: t("chat.guest.country"), value: conv.guest_country },
    {
      label: t("common.date"),
      value: conv.created_at
        ? new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(
            new Date(conv.created_at),
          )
        : null,
    },
    { label: t("common.status"), value: t(`chat.status.${conv.status}`) },
  ].filter((r) => Boolean(r.value));

  return (
    <div className="border-b border-border bg-muted/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
      >
        <span className="truncate">{t("chat.admin.info.title")}</span>
        <span className="shrink-0">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 px-3 pb-3 text-xs">
          {rows.length === 0 && (
            <p className="text-muted-foreground">{t("chat.admin.info.none")}</p>
          )}
          {rows.map((r) => (
            <div key={r.label} className="flex min-w-0 items-baseline gap-2">
              <dt className="shrink-0 text-muted-foreground">{r.label}</dt>
              <dd className="min-w-0 flex-1 truncate font-medium text-foreground">{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

// ------------------ Sub-components ------------------

function MessageBubble({ m, mode }: { m: ChatMessage; mode: "client" | "agent" }) {
  const { i18n, t } = useTranslation();
  const isSystem = m.sender_type === "system";
  const isMe =
    (mode === "client" && m.sender_type === "client") ||
    (mode === "agent" && m.sender_type === "agent");
  const isAgent = m.sender_type === "agent" || m.sender_type === "bot";

  if (isSystem) {
    return (
      <div
        className="text-center text-[11px] text-muted-foreground italic"
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(m.content_html) }}
      />
    );
  }

  return (
    <div className={cn("flex items-end gap-2", isMe ? "flex-row-reverse" : "")}>
      <Avatar sender={m.sender_type} name={m.sender_name} />
      <div
        className={cn(
          "max-w-[78%] rounded-2xl px-3 py-2 text-sm shadow-sm",
          isMe
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : isAgent
              ? "bg-card text-foreground border border-border rounded-bl-sm"
              : "bg-secondary text-foreground rounded-bl-sm",
        )}
      >
        {!isMe && m.sender_name && (
          <p className="text-[11px] font-semibold mb-0.5 opacity-80">
            {m.sender_name}
            {m.sender_type === "bot" && (
              <span className="ml-1 opacity-60">({t("chat.assistant")})</span>
            )}
          </p>
        )}
        <div
          className="chat-html [&_a]:underline [&_a]:font-medium [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:leading-snug space-y-1"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(m.content_html) }}
        />
        <p className={cn("text-[10px] mt-1 opacity-70", isMe ? "text-right" : "text-left")}>
          {formatTime(m.created_at, i18n.language)}
        </p>
      </div>
    </div>
  );
}

function Avatar({ sender, name }: { sender: string; name?: string | null }) {
  if (sender === "bot") {
    return (
      <div className="h-7 w-7 rounded-full bg-[#00915A] grid place-items-center shrink-0">
        <BankLogo className="h-4 w-4" />
      </div>
    );
  }
  if (sender === "agent") {
    return (
      <div className="h-7 w-7 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-700 text-white text-[10px] font-bold grid place-items-center shrink-0">
        {initials(name)}
      </div>
    );
  }
  return (
    <div className="h-7 w-7 rounded-full bg-muted text-foreground text-[10px] font-bold grid place-items-center shrink-0">
      {initials(name)}
    </div>
  );
}

function BankLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true">
      <rect width="40" height="40" rx="6" fill="#77E4C0" />
      <g fill="#0A0A0A">
        <path d="M9 18 L15 12 L14 20 Z" />
        <path d="M20 14 L27 10 L25 18 Z" />
        <path d="M13 24 L22 22 L18 28 Z" />
        <path d="M26 24 L32 22 L28 30 Z" />
      </g>
    </svg>
  );
}

function BrandBanner({ position }: { position: "top" | "bottom" }) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "text-[10px] text-center px-3 py-1.5 bg-muted/50 border-border",
        position === "top" ? "border-b" : "border-t",
      )}
    >
      <span className="text-muted-foreground">
        {position === "top"
          ? t("chat.banner.top")
          : t("chat.banner.bottom", { year: new Date().getFullYear() })}
      </span>
    </div>
  );
}

// ------------------ Composer riche ------------------
function RichComposer({
  disabled,
  onSend,
}: {
  disabled?: boolean;
  onSend: (html: string, format: "html" | "text") => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);

  const exec = (cmd: string, value?: string) => {
    document.execCommand(cmd, false, value);
    ref.current?.focus();
  };

  const submit = () => {
    const html = ref.current?.innerHTML ?? "";
    if (!html.trim() || html === "<br>") return;
    onSend(html, "html");
    if (ref.current) ref.current.innerHTML = "";
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="p-2">
      <div className="flex items-center gap-1 mb-1">
        <ToolbarBtn onClick={() => exec("bold")} label={t("chat.rt.bold")}>
          <Bold className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => exec("italic")} label={t("chat.rt.italic")}>
          <Italic className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => {
            const url = window.prompt(t("chat.rt.linkPrompt"));
            if (url && /^https?:\/\//i.test(url)) exec("createLink", url);
          }}
          label={t("chat.rt.link")}
        >
          <Link2 className="h-3.5 w-3.5" />
        </ToolbarBtn>
      </div>
      <div className="flex items-end gap-2">
        <div
          ref={ref}
          contentEditable
          role="textbox"
          aria-multiline="true"
          onKeyDown={onKeyDown}
          data-placeholder={t("chat.compose.placeholder")}
          className={cn(
            "flex-1 min-h-[40px] max-h-32 overflow-y-auto rounded-2xl border border-border bg-background px-3 py-2 text-sm",
            "focus:outline-none focus:ring-2 focus:ring-primary/30",
            "empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground",
          )}
          suppressContentEditableWarning
        />
        <Button
          type="button"
          size="icon"
          onClick={submit}
          disabled={disabled}
          className="h-10 w-10 rounded-full shrink-0"
        >
          {disabled ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

function ToolbarBtn({
  children,
  onClick,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={label}
      className="h-7 w-7 grid place-items-center rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
    >
      {children}
    </button>
  );
}

// Icone messagerie exportée pour boutons externes
export const ChatIcon = MessageCircle;
