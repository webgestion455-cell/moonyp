import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Bold, CheckCircle2, Italic, Link2, MessageCircle, Send, RefreshCw, UserRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/admin/chat")({ component: SupportInbox });
type Conversation = { id: string; guest_name: string | null; guest_email: string | null; subject: string | null; ticket_number: string | null; status: string; agent_name: string | null; unread_for_admin: number; last_message_at: string };
type ChatMessage = { id: string; sender: string; sender_name: string | null; content: string; sender_avatar_url: string | null; signature: string | null; created_at: string };
function localDate(value: string) { return new Intl.DateTimeFormat(undefined, { month: "short", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(new Date(value)); }
function shortName(value?: string | null) { const clean = (value || "Client").trim(); return clean.split(/\\s+/)[0] || "Client"; }
function MessageText({ value }: { value: string }) {
  const tokens = value.split(/(https?:\\/\\/[^\\s<]+|www\\.[^\\s<]+|\\*\\*[^*]+\\*\\*|(?<!\\*)\\*[^*\\n]+\\*(?!\\*))/g);
  return <span className="whitespace-pre-wrap break-words">{tokens.map((token, i) => {
    if (/^(https?:\\/\\/|www\\.)/.test(token)) {
      const href = token.startsWith("www.") ? "https://" + token : token;
      const trailing = href.match(/[.,!?;:)]+$/)?.[0] || "";
      const cleanHref = trailing ? href.slice(0, -trailing.length) : href;
      return <span key={i}><a href={cleanHref} target="_blank" rel="noopener noreferrer" className="break-all text-primary underline underline-offset-2">{cleanHref.replace(/^https?:\\/\\//, "")}</a>{trailing}</span>;
    }
    if (token.startsWith("**") && token.endsWith("**")) return <strong key={i}>{token.slice(2,-2)}</strong>;
    if (token.startsWith("*") && token.endsWith("*")) return <em key={i}>{token.slice(1,-1)}</em>;
    return <span key={i}>{token}</span>;
  })}</span>;
}
async function support(action: string, extra: Record<string, unknown> = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const { data, error } = await supabase.functions.invoke("moonyp-support", { body: { action, ...extra }, headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {} });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}
function SupportInbox() {
  const [items, setItems] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState("open");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editor = useRef<HTMLTextAreaElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const loadList = useCallback(async () => {
    try { const data = await support("list", { status: filter }); setItems(data.conversations ?? []); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Impossible de charger les conversations."); }
  }, [filter]);
  const loadMessages = useCallback(async () => {
    if (!selected) return;
    try { const data = await support("messages", { conversationId: selected.id }); setMessages(data.messages ?? []); }
    catch (e) { setError(e instanceof Error ? e.message : "Impossible de charger les messages."); }
  }, [selected?.id]);
  useEffect(() => { void loadList(); const id = window.setInterval(() => void loadList(), 5000); return () => window.clearInterval(id); }, [loadList]);
  useEffect(() => { void loadMessages(); const id = window.setInterval(() => void loadMessages(), 3000); return () => window.clearInterval(id); }, [loadMessages]);
  useEffect(() => { if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight; }, [messages, selected?.id]);
  function wrapSelection(before: string, after = before) {
    const el = editor.current; if (!el) return;
    const start = el.selectionStart, end = el.selectionEnd;
    const selectedText = draft.slice(start, end);
    const insert = selectedText || (before === "[" ? "texte du lien" : "texte");
    const next = draft.slice(0,start) + before + insert + after + draft.slice(end);
    setDraft(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + before.length, start + before.length + insert.length); });
  }
  async function send() {
    if (!selected || !draft.trim() || busy) return;
    setBusy(true); setError("");
    try { await support("send", { conversationId: selected.id, message: draft.trim(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }); setDraft(""); await loadMessages(); await loadList(); }
    catch (e) { setError(e instanceof Error ? e.message : "Envoi impossible."); }
    finally { setBusy(false); }
  }
  async function close() {
    if (!selected) return;
    try { await support("close", { conversationId: selected.id }); await loadList(); setSelected({ ...selected, status: "closed" }); }
    catch (e) { setError(e instanceof Error ? e.message : "Fermeture impossible."); }
  }
  return <main className="mx-auto max-w-[1500px] space-y-4 px-3 py-4 sm:px-5 sm:py-6">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[.22em] text-primary">MOONYP · Assistance</p><h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Centre de support</h1><p className="mt-1 text-sm text-muted-foreground">Conversations clients, réponses et suivi en direct.</p></div><Button variant="outline" size="sm" onClick={() => { void loadList(); void loadMessages(); }}><RefreshCw className="mr-2 h-4 w-4"/>Actualiser</Button></header>
    {error && <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
    <div className="grid min-h-[calc(100dvh-190px)] gap-3 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
      <Card className={`min-h-0 overflow-hidden ${selected ? "hidden lg:flex lg:flex-col" : "flex flex-col"}`}>
        <CardHeader className="shrink-0 border-b p-4"><CardTitle className="flex items-center gap-2 text-base"><MessageCircle className="h-4 w-4"/>Conversations <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs">{items.length}</span></CardTitle><div className="flex flex-wrap gap-1.5 pt-2">{["open","waiting_agent","closed","all"].map(s=><button key={s} onClick={()=>setFilter(s)} className={`rounded-full px-3 py-1.5 text-xs ${filter===s?"bg-black text-white":"bg-muted text-muted-foreground"}`}>{({open:"Ouvertes",waiting_agent:"En attente",closed:"Clôturées",all:"Toutes"} as Record<string,string>)[s]}</button>)}</div></CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-y-auto p-0">{items.map(c=><button key={c.id} onClick={()=>{setSelected(c);setMessages([]);}} className={`block w-full border-b p-3 text-left transition hover:bg-muted/50 sm:p-4 ${selected?.id===c.id?"bg-muted":""}`}><span className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground"><UserRound className="h-5 w-5"/></span><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2 font-medium"><span className="truncate">{shortName(c.guest_name)}</span>{c.unread_for_admin>0&&<span className="rounded-full bg-black px-2 py-0.5 text-[10px] text-white">{c.unread_for_admin}</span>}</span><span className="block truncate text-sm text-muted-foreground">{c.subject||"Demande d'assistance"}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{c.ticket_number||c.id.slice(0,8)} · {localDate(c.last_message_at)}</span></span></span></button>)}{!items.length&&<p className="p-8 text-center text-sm text-muted-foreground">Aucune conversation dans ce filtre.</p>}</CardContent>
      </Card>
      <Card className={`min-h-0 flex-col overflow-hidden ${selected ? "flex" : "hidden lg:flex"}`}>
        {selected ? <><CardHeader className="shrink-0 border-b p-3 sm:p-4"><div className="flex items-center gap-3"><Button variant="ghost" size="icon" className="lg:hidden" aria-label="Retour aux conversations" onClick={()=>setSelected(null)}><ArrowLeft className="h-5 w-5"/></Button><span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">{<UserRound className="h-5 w-5 text-muted-foreground"/>}</span><div className="min-w-0 flex-1"><CardTitle className="truncate text-base">{shortName(selected.guest_name)}</CardTitle><p className="mt-1 truncate text-xs text-muted-foreground">{selected.ticket_number} · {selected.guest_email||"Visiteur"} · {selected.status}</p></div>{selected.status!=="closed"&&<Button variant="outline" size="sm" onClick={close}><CheckCircle2 className="mr-1.5 h-4 w-4"/><span className="hidden sm:inline">Clôturer</span></Button>}</div></CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col p-0"><div ref={transcript} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">{messages.map(m=><article key={m.id} className="flex gap-3 border-b border-dotted border-border/80 pb-5 pt-1 last:border-0 last:pb-0 sm:gap-4 sm:pb-6"><div className="h-10 w-10 shrink-0 overflow-hidden rounded-md border bg-muted">{m.sender_avatar_url?<img src={m.sender_avatar_url} alt="" className="h-full w-full object-cover"/>:<div className="flex h-full items-center justify-center text-sm font-semibold text-muted-foreground">{shortName(m.sender_name||selected.guest_name).slice(0,1).toUpperCase()}</div>}</div><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{shortName(m.sender_name||selected.guest_name)}{m.sender==="agent"?" (MOONYP)":""}</p><p className="mt-1 text-xs text-muted-foreground">{localDate(m.created_at)}</p><div className="mt-3 text-sm leading-6"><MessageText value={m.content}/></div>{m.sender==="agent"&&m.signature&&<div className="mt-5 space-y-2 text-sm leading-6">{m.signature.split(" | ").map((line,index)=><p key={`${m.id}-signature-${index}`} className={index===1?"font-medium":index===2?"font-semibold":""}>{line}</p>)}</div>}</div></article>)}{!messages.length&&<p className="py-10 text-center text-sm text-muted-foreground">Chargement des messages…</p>}</div>
          {selected.status!=="closed"&&<form className="shrink-0 border-t bg-background p-3 pb-[calc(.75rem+env(safe-area-inset-bottom))] sm:p-4" onSubmit={e=>{e.preventDefault();void send();}}><div className="mb-2 flex flex-wrap items-center gap-1 rounded-lg border bg-muted/30 p-1"><button type="button" title="Gras" onClick={()=>wrapSelection("**")} className="rounded-md p-2 hover:bg-muted"><Bold className="h-4 w-4"/></button><button type="button" title="Italique" onClick={()=>wrapSelection("*")} className="rounded-md p-2 hover:bg-muted"><Italic className="h-4 w-4"/></button><button type="button" title="Lien" onClick={()=>wrapSelection("[","](https://)")} className="rounded-md p-2 hover:bg-muted"><Link2 className="h-4 w-4"/></button><span className="ml-auto pr-2 text-xs text-muted-foreground">Gras **texte** · italique *texte* · liens www…</span></div><textarea ref={editor} value={draft} onChange={e=>setDraft(e.target.value)} maxLength={4000} rows={3} placeholder="Écrire une réponse professionnelle…" className="max-h-40 min-h-20 w-full resize-y rounded-xl border bg-background p-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-black/20"/><div className="mt-2 flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-muted-foreground">Signature professionnelle ajoutée automatiquement</span><Button type="submit" disabled={busy||!draft.trim()} className="bg-black text-white hover:bg-black/85"><Send className="mr-2 h-4 w-4"/>Envoyer</Button></div></form>}</CardContent></> : <div className="flex min-h-[50vh] flex-col items-center justify-center p-10 text-center"><MessageCircle className="h-10 w-10 text-muted-foreground"/><h2 className="mt-4 font-semibold">Sélectionne une conversation</h2><p className="mt-1 max-w-sm text-sm text-muted-foreground">Les nouveaux messages apparaissent automatiquement ici.</p></div>}
      </Card>
    </div>
  </main>;
}
