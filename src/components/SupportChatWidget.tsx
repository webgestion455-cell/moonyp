import { useEffect, useRef, useState } from "react";
import { MessageCircle, X, Send, LoaderCircle, Headphones, BellRing, UserRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Msg = { id: string; sender: string; sender_name: string | null; content: string; sender_avatar_url?: string | null; signature?: string | null; created_at: string };
const TOKEN_KEY = "moonyp.support.guest";
const CONV_KEY = "moonyp.support.conversation";
function vapidBytes(value: string) { const pad = "=".repeat((4 - value.length % 4) % 4); const raw = atob((value + pad).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(raw, ch => ch.charCodeAt(0)); }
async function callSupport(action: string, payload: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke("moonyp-support", {
    body: { action, ...payload },
    headers: {},
  });
  if (error) {
    let message = error.message || "La requête d’assistance a échoué.";
    const context = (error as unknown as { context?: { json?: () => Promise<{ error?: string }> } }).context;
    if (context?.json) {
      try { const body = await context.json(); if (body?.error) message = body.error; } catch { /* network or non-JSON response */ }
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
function safeMessageHtml(value: string) {
  const escape = (s: string) => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  if (!/<(strong|b|em|i|u|a|br|p|div|ul|ol|li)\\b/i.test(value)) {
    return escape(value).replace(/(https?:\\/\\/[^\\s<]+|www\\.[^\\s<]+)/g, (url) => {
      const href = url.startsWith("www.") ? "https://" + url : url;
      return '<a href="' + href.replace(/"/g,"%22") + '" target="_blank" rel="noopener noreferrer">' + url + '</a>';
    }).replace(/\\n/g,"<br>");
  }
  return value.replace(/<\\/?(script|style|iframe|object|svg)[^>]*>/gi,"")
    .replace(/\\s+on[a-z]+\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)/gi,"")
    .replace(/javascript\\s*:/gi,"")
    .replace(/<(?!\\/?(?:strong|b|em|i|u|a|br|p|div|ul|ol|li)\\b)[^>]*>/gi,"")
    .replace(/<(a)\\b([^>]*)>/gi, (_m, _tag, attrs) => {
      const match = attrs.match(/href\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)/i);
      if (!match) return "<a>";
      const href = match[1].replace(/^["']|["']$/g,"");
      if (!/^https?:\\/\\//i.test(href)) return "<a>";
      return '<a href="' + escape(href) + '" target="_blank" rel="noopener noreferrer">';
    });
}
function stamp(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(new Date(value));
}
export function SupportChatWidget() {
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [conversationId, setConversationId] = useState(() => { try { return localStorage.getItem(CONV_KEY) || ""; } catch { return ""; } });
  const [guestToken, setGuestToken] = useState(() => { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; } });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [initialMessage, setInitialMessage] = useState("");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [error, setError] = useState("");
  const [pushEnabled, setPushEnabled] = useState(false);
  const [conversationClosed, setConversationClosed] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const ready = Boolean(conversationId && guestToken);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);
  async function start(e: React.FormEvent) {
    e.preventDefault(); if (!name.trim() || !initialMessage.trim() || starting) return;
    setStarting(true); setError("");
    try {
      const data = await callSupport("start", { name: name.trim(), email: email.trim(), message: initialMessage.trim(), subject: subject.trim(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, locale: navigator.language });
      setConversationId(data.conversation.id); setGuestToken(data.guestToken); setInitialMessage("");
      localStorage.setItem(CONV_KEY, data.conversation.id); localStorage.setItem(TOKEN_KEY, data.guestToken);
    } catch (err) { setError(err instanceof Error ? err.message : "Impossible d’ouvrir la conversation."); }
    finally { setStarting(false); }
  }
  async function load() {
    if (!ready) return;
    try { const data = await callSupport("messages", { conversationId, guestToken, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }); setMessages(data.messages ?? []); setConversationClosed(data.conversation?.status === "closed"); setError(""); }
    catch (err) { setError(err instanceof Error ? err.message : "Chargement des messages impossible."); }
  }
  useEffect(() => { if (!open || !ready) return; void load(); const timer = window.setInterval(() => void load(), 3000); return () => window.clearInterval(timer); }, [open, ready, conversationId, guestToken]);
  useEffect(() => { if (open) { stickToBottom.current = true; requestAnimationFrame(() => bottom.current?.scrollIntoView({ behavior: "auto" })); } }, [open, conversationId]);
  useEffect(() => { if (stickToBottom.current) bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  async function enablePush() {
    if (!ready || pushBusy || !("Notification" in window) || !("serviceWorker" in navigator)) {
      setError("Les notifications ne sont pas disponibles sur ce navigateur.");
      return;
    }
    setPushBusy(true); setError("");
    try {
      const config = await callSupport("config");
      const vapidPublicKey = config.vapidPublicKey as string | null;
      if (!vapidPublicKey) throw new Error("Les notifications push ne sont pas encore configurées sur le serveur.");
      const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Autorisez les notifications dans les réglages de votre navigateur.");
      const registration = await navigator.serviceWorker.register("/sw.js");
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidBytes(vapidPublicKey) });
      await callSupport("subscribe_guest", { conversationId, guestToken, subscription: subscription.toJSON() });
      setPushEnabled(true);
    } catch (err) { setError(err instanceof Error ? err.message : "Activation des notifications impossible."); }
    finally { setPushBusy(false); }
  }
  async function send(e: React.FormEvent) {
    e.preventDefault(); if (!draft.trim() || busy || !ready) return;
    setBusy(true); setError("");
    try { await callSupport("send", { conversationId, guestToken, message: draft.trim(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }); setDraft(""); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : "Envoi impossible."); }
    finally { setBusy(false); }
  }
  return <div className={open ? "fixed inset-0 z-[100] h-[100dvh] w-screen bg-background sm:inset-auto sm:bottom-6 sm:right-6 sm:h-auto sm:w-auto sm:bg-transparent" : "fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] right-4 z-[80] sm:bottom-6 sm:right-6"}>
    {open && <section aria-label="Assistance MOONYP" className="flex h-[100dvh] w-full flex-col overflow-hidden bg-background shadow-2xl sm:mb-3 sm:h-[min(720px,82vh)] sm:w-[min(440px,calc(100vw-3rem))] sm:rounded-2xl sm:border">
      <header className="flex shrink-0 items-center gap-3 bg-black px-4 pb-4 pt-[calc(1rem+env(safe-area-inset-top))] text-white sm:pt-4">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10"><Headphones className="h-5 w-5"/></span>
        <span className="min-w-0 flex-1"><strong className="block text-sm">Assistance MOONYP</strong><span className="text-xs opacity-80">Nous sommes là pour vous aider</span></span>
        <button aria-label="Fermer le chat" onClick={() => setOpen(false)} className="rounded-lg p-2 hover:bg-white/15"><X className="h-5 w-5"/></button>
      </header>
      {!ready ? <form onSubmit={start} className="flex-1 space-y-4 overflow-y-auto p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
        <div><h2 className="text-lg font-semibold">Comment pouvons-nous vous aider ?</h2><p className="mt-1 text-sm text-muted-foreground">Laissez-nous vos coordonnées pour ouvrir une conversation avec notre équipe.</p></div>
        <label className="block text-sm">Votre nom *<input required maxLength={100} value={name} onChange={e=>setName(e.target.value)} className="mt-1 w-full rounded-lg border bg-background px-3 py-2.5" placeholder="Nom complet"/></label>
        <label className="block text-sm">E-mail (facultatif)<input type="email" maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} className="mt-1 w-full rounded-lg border bg-background px-3 py-2.5" placeholder="vous@exemple.com"/></label>
        <label className="block text-sm">Sujet (facultatif)<input maxLength={160} value={subject} onChange={e=>setSubject(e.target.value)} className="mt-1 w-full rounded-lg border bg-background px-3 py-2.5" placeholder="Objet de votre demande"/></label>
        <label className="block text-sm">Votre message *<textarea required maxLength={4000} rows={3} value={initialMessage} onChange={e=>setInitialMessage(e.target.value)} className="mt-1 w-full resize-y rounded-lg border bg-background px-3 py-2.5" placeholder="Décrivez votre demande…"/></label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <button disabled={starting} className="flex w-full items-center justify-center gap-2 rounded-lg bg-black px-4 py-3 font-medium text-white disabled:opacity-60">{starting&&<LoaderCircle className="h-4 w-4 animate-spin"/>}Démarrer la conversation</button>
      </form> : <>
        <div ref={transcript} onScroll={e => { const el=e.currentTarget; stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100; }} className="flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 sm:p-5">
          {!conversationClosed && !pushEnabled && <button onClick={() => void enablePush()} disabled={pushBusy} className="flex w-full items-center justify-center gap-2 rounded-xl border border-black/20 bg-black px-3 py-2 text-xs font-medium text-white disabled:opacity-60"><BellRing className="h-4 w-4"/>{pushBusy ? "Activation…" : "Activer les notifications de réponse"}</button>}
          {!messages.length && <p className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">Votre demande a été ouverte. Écrivez votre message : notre équipe vous répondra ici.</p>}{conversationClosed && }
          {messages.map(m => <article key={m.id} className="flex gap-3 border-b border-dotted pb-5 last:border-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">{m.sender==="agent" ? <img src={m.sender_avatar_url || "/icon-192.png"} alt="" className="h-full w-full object-cover" /> : <UserRound className="h-5 w-5 text-muted-foreground" />}</div>
            <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{m.sender==="agent" ? `${(m.sender_name||"Assistance").trim().split(/\s+/)[0]} (MOONYP)` : ((m.sender_name||name||"Vous").trim().split(/\s+/)[0])}</p><p className="mt-1 text-xs text-muted-foreground">{stamp(m.created_at)}</p><div className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 [&_a]:text-primary [&_a]:underline [&_strong]:font-bold [&_em]:italic [&_u]:underline" dangerouslySetInnerHTML={{ __html: safeMessageHtml(m.content) }} />{m.sender==="agent" && m.signature && <div className="mt-5 space-y-4 text-sm leading-6">{m.signature.replace(/\\n/g, "\n").split(/\n+/).filter(Boolean).map((line,index)=><p key={`${m.id}-signature-${index}`} className={index===1?"font-medium":index===2?"font-semibold":""}>{line}</p>)}</div>}</div>
          </article>)}
          {conversationClosed && <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4"><p className="font-semibold">Cette conversation est clôturée.</p><p className="mt-1 text-sm text-muted-foreground">Pour obtenir une nouvelle assistance, démarrez une nouvelle conversation.</p><button type="button" onClick={()=>{localStorage.removeItem(CONV_KEY);localStorage.removeItem(TOKEN_KEY);setConversationId("");setGuestToken("");setMessages([]);setDraft("");setConversationClosed(false);setPushEnabled(false);setError("");}} className="mt-3 rounded-lg bg-black px-4 py-2.5 text-sm font-medium text-white">Nouvelle conversation</button></div>}\n          <div ref={bottom}/>
        </div>
        {error && <p role="alert" className="px-4 text-xs text-destructive">{error}</p>}
        {!conversationClosed && <form onSubmit={send} className="flex shrink-0 items-end gap-2 border-t p-3 pb-[calc(.75rem+env(safe-area-inset-bottom))] sm:pb-3"><textarea value={draft} onChange={e=>setDraft(e.target.value)} maxLength={4000} rows={2} className="max-h-28 min-h-11 flex-1 resize-y rounded-xl border bg-background px-3 py-2 text-sm" placeholder="Écrivez votre message…" aria-label="Votre message"/><button disabled={busy||!draft.trim()} aria-label="Envoyer le message" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-black text-white disabled:opacity-50"><Send className="h-4 w-4"/></button></form>}
      </>}
    </section>}
    {!open && <button onClick={()=>setOpen(true)} aria-label="Contacter l’assistance" className="ml-auto flex h-14 w-14 items-center justify-center rounded-full bg-black text-white shadow-xl transition hover:scale-105"><MessageCircle className="h-6 w-6"/></button>}
  </div>;
}
