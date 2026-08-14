import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { MessageCircle, X, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase } from "@/integrations/supabase/client";
import { ChatWindow, ensureConversation } from "./chat/ChatWindow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const GUEST_STORAGE_KEY = "bnpparibas.chat.guest";

interface GuestSession {
  conversationId: string;
  ticketNumber: string;
  name: string;
  email: string;
}

function readGuestSession(): GuestSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(GUEST_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as GuestSession;
  } catch {
    return null;
  }
}

export function LiveChat() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [guest, setGuest] = useState<GuestSession | null>(null);

  // Restore guest session
  useEffect(() => {
    if (!user) setGuest(readGuestSession());
  }, [user]);

  useEffect(() => {
    if (!open || !user || conversationId) return;
    setLoading(true);
    ensureConversation(user.id, {
      greeting: t("chat.welcome.greeting"),
      help: t("chat.welcome.help"),
    })
      .then((c) => setConversationId(c.id))
      .catch((e) => console.error("chat init", e))
      .finally(() => setLoading(false));
  }, [open, user, conversationId, t]);


  // Cachée sur mobile pour utilisateurs connectés (dashboard/admin) —
  // ils accèdent via /chat ou /admin/chat
  if (isMobile && user) return null;

  const handleGuestCreated = (session: GuestSession) => {
    localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(session));
    setGuest(session);
  };

  const activeConversationId = user ? conversationId : guest?.conversationId ?? null;
  const chatMode: "client" | "guest" | null = user ? "client" : guest ? "guest" : null;

  return (
    <>
      <button
        type="button"
        aria-label={t("livechat.open")}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "fixed z-40 bottom-20 right-4 sm:bottom-6 sm:right-6 h-14 w-14 rounded-full shadow-elevated grid place-items-center",
          "bg-[#00915A] text-white hover:scale-105 transition",
        )}
      >
        {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Live chat BNP PARIBAS"
          className="fixed z-40 inset-x-2 bottom-2 top-2 sm:inset-auto sm:top-auto sm:bottom-24 sm:right-6 sm:w-[min(400px,calc(100vw-3rem))] sm:h-[620px] sm:max-h-[85vh]"
        >

          {chatMode === null ? (
            <GuestForm onCreated={handleGuestCreated} onCancel={() => setOpen(false)} />
          ) : loading ? (
            <div className="h-full grid place-items-center rounded-2xl border border-border bg-card">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : activeConversationId ? (
            <ChatWindow
              conversationId={activeConversationId}
              mode="client"
              guestMode={chatMode === "guest"}
              onClose={() => setOpen(false)}
            />
          ) : null}
        </div>
      )}
    </>
  );
}

// ------------------ Formulaire GUEST (visiteur non-connecté) ------------------
function GuestForm({
  onCreated,
  onCancel,
}: {
  onCreated: (s: GuestSession) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    whatsapp: "",
    country: "",
    subject: "Assistance",
    message: "",
  });
  const [sending, setSending] = useState(false);

  const set = <K extends keyof typeof form>(k: K, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.message) {
      toast.error(t("chat.guest.errors.required"));
      return;
    }
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("chat-guest-start", {
        body: form,
      });
      if (error) throw error;
      const payload = data as { conversationId: string; ticketNumber: string };
      onCreated({
        conversationId: payload.conversationId,
        ticketNumber: payload.ticketNumber,
        name: form.name,
        email: form.email,
      });
      toast.success(t("chat.guest.created", { ticket: payload.ticketNumber }));
    } catch (e) {
      toast.error(t("chat.guest.errors.fail"));
      console.error(e);
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="h-full flex flex-col rounded-2xl border border-border bg-card overflow-hidden shadow-elevated"
    >
      <header className="bg-[#00915A] text-white px-4 py-3 flex items-center justify-between">
        <div>
          <p className="font-bold tracking-wide">BNP PARIBAS</p>
          <p className="text-[11px] opacity-90">{t("chat.guest.subtitle")}</p>
        </div>
        <button type="button" onClick={onCancel} aria-label="Fermer">
          <X className="h-5 w-5" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <p className="text-sm text-muted-foreground">{t("chat.guest.intro")}</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Input
            required
            placeholder={t("chat.guest.name")}
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
          />
          <Input
            required
            type="email"
            placeholder={t("chat.guest.email")}
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
          />
          <Input
            placeholder={t("chat.guest.phone")}
            value={form.phone}
            onChange={(e) => set("phone", e.target.value)}
          />
          <Input
            placeholder={t("chat.guest.whatsapp")}
            value={form.whatsapp}
            onChange={(e) => set("whatsapp", e.target.value)}
          />
          <Input
            className="sm:col-span-2"
            placeholder={t("chat.guest.country")}
            value={form.country}
            onChange={(e) => set("country", e.target.value)}
          />
          <Input
            className="sm:col-span-2"
            placeholder={t("chat.guest.subject")}
            value={form.subject}
            onChange={(e) => set("subject", e.target.value)}
          />
        </div>

        <Textarea
          required
          rows={4}
          placeholder={t("chat.guest.message")}
          value={form.message}
          onChange={(e) => set("message", e.target.value)}
        />

        <p className="text-[11px] text-muted-foreground">
          {t("chat.guest.privacy")}
        </p>
      </div>

      <div className="border-t border-border p-3 bg-muted/30">
        <Button type="submit" disabled={sending} className="w-full bg-[#00915A] hover:bg-[#00754A]">
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <Send className="h-4 w-4 mr-2" />
              {t("chat.guest.submit")}
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
