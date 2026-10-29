import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { MessageCircle, Send, CheckCircle2, RefreshCw, UserRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/admin/chat")({ component: SupportInbox });

type Conversation = { id: string; guest_name: string | null; guest_email: string | null; subject: string | null; ticket_number: string | null; status: string; agent_name: string | null; unread_for_admin: number; last_message_at: string };
type ChatMessage = { id: string; sender: string; sender_name: string | null; content: string; sender_avatar_url: string | null; signature: string | null; created_at: string };

function localDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(new Date(value));
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
  const loadList = useCallback(async () => {
    try { const data = await support("list", { status: filter }); setItems(data.conversations ?? []); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Impossible de charger les conversations."); }
  }, [filter]);
  const loadMessages = useCallback(async () => {
    if (!selected) return;
    try { const data = await support("messages", { conversationId: selected.id }); setMessages(data.messages ?? []); }
    catch (e) { setError(e instanceof Error ? e.message : "Impossible de charger les messages."); }
  }, [selected]);
  useEffect(() => { void loadList(); const id = window.setInterval(() => void loadList(), 5000); return () => window.clearInterval(id); }, [loadList]);
  useEffect(() => { void loadMessages(); const id = window.setInterval(() => void loadMessages(), 3000); return () => window.clearInterval(id); }, [loadMessages]);
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
  return <main className="mx-auto max-w-7xl space-y-5 px-4 py-8">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[.22em] text-primary">MOONYP · Assistance</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Centre de support</h1><p className="mt-1 text-sm text-muted-foreground">Conversations clients, réponses et suivi en direct.</p></div><Button variant="outline" onClick={() => { void loadList(); void loadMessages(); }}><RefreshCw className="mr-2 h-4 w-4"/>Actualiser</Button></header>
    {error && <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
    <div className="grid min-h-[620px] gap-4 lg:grid-cols-[350px_1fr]">
      <Card className="overflow-hidden"><CardHeader className="border-b"><CardTitle className="flex items-center gap-2 text-base"><MessageCircle className="h-4 w-4"/>Conversations <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs">{items.length}</span></CardTitle><div className="flex gap-2 pt-2">{["open","waiting_agent","closed","all"].map(s=><button key={s} onClick={()=>setFilter(s)} className={`rounded-full px-3 py-1.5 text-xs ${filter===s?"bg-primary text-primary-foreground":"bg-muted text-muted-foreground"}`}>{({open:"Ouvertes",waiting_agent:"En attente",closed:"Clôturées",all:"Toutes"} as Record<string,string>)[s]}</button>)}</div></CardHeader><CardContent className="p-0">{items.map(c=><button key={c.id} onClick={()=>setSelected(c)} className={`block w-full border-b p-4 text-left transition hover:bg-muted/50 ${selected?.id===c.id?"bg-muted":""}`}><div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><UserRound className="h-5 w-5"/></span><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2 font-medium">{c.guest_name||"Client"}{c.unread_for_admin>0&&<span className="rounded-full bg-primary px-2 py-0.5 text-[10px] text-primary-foreground">{c.unread_for_admin}</span>}</span><span className="block truncate text-sm text-muted-foreground">{c.subject||"Demande d'assistance"}</span><span className="mt-1 block text-xs text-muted-foreground">{c.ticket_number||c.id.slice(0,8)} · {localDate(c.last_message_at)}</span></span></div></button>)}{!items.length&&<p className="p-8 text-center text-sm text-muted-foreground">Aucune conversation dans ce filtre.</p>}</CardContent></Card>
      <Card className="flex min-h-[620px] flex-col overflow-hidden">{selected?<><CardHeader className="flex-row items-center justify-between border-b"><div><CardTitle className="text-base">{selected.guest_name||"Client"}</CardTitle><p className="mt-1 text-xs text-muted-foreground">{selected.ticket_number} · {selected.guest_email||"Visiteur"} · {selected.status}</p></div>{selected.status!=="closed"&&<Button variant="outline" size="sm" onClick={close}><CheckCircle2 className="mr-2 h-4 w-4"/>Clôturer</Button>}</CardHeader><CardContent className="flex flex-1 flex-col p-0"><div className="flex-1 space-y-5 overflow-y-auto p-5">{messages.map(m=><article key={m.id} className="flex gap-3 border-b border-dotted pb-5 last:border-0"><div className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-muted">{m.sender_avatar_url?<img src={m.sender_avatar_url} alt="" className="h-full w-full object-cover"/>:<div className="flex h-full items-center justify-center"><UserRound className="h-5 w-5 text-muted-foreground"/></div>}</div><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{m.sender_name||"Client"}{m.sender==="agent"?" (MOONYP)":""}</p><p className="mt-1 text-xs text-muted-foreground">{localDate(m.created_at)}</p><div className={`my-3 rounded-xl px-4 py-3 text-sm leading-6 shadow-sm ${m.sender==="agent" ? "border border-primary/10 bg-primary/5" : "bg-muted/70"}`}><p className="whitespace-pre-wrap break-words">{m.content}</p></div>{m.sender==="agent"&&m.signature&&<div className="space-y-0.5 border-l-2 border-primary/30 pl-3 text-xs leading-5 text-muted-foreground">{m.signature.split(" | ").map((line,index)=><p key={`${m.id}-signature-${index}`} className={index===0?"font-semibold text-foreground":""}>{line}</p>)}</div>}</div></article>)}</div>{selected.status!=="closed"&&<form className="border-t p-4" onSubmit={e=>{e.preventDefault();void send();}}><textarea value={draft} onChange={e=>setDraft(e.target.value)} maxLength={4000} rows={3} placeholder="Écrire une réponse professionnelle…" className="w-full resize-y rounded-xl border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-primary" /><div className="mt-2 flex justify-between"><span className="text-xs text-muted-foreground">Signature MOONYP ajoutée automatiquement</span><Button type="submit" disabled={busy||!draft.trim()}><Send className="mr-2 h-4 w-4"/>Envoyer</Button></div></form>}</CardContent></>:<div className="flex flex-1 flex-col items-center justify-center p-10 text-center"><MessageCircle className="h-10 w-10 text-muted-foreground"/><h2 className="mt-4 font-semibold">Sélectionne une conversation</h2><p className="mt-1 max-w-sm text-sm text-muted-foreground">Les nouveaux messages apparaissent automatiquement ici.</p></div>}</Card>
    </div>
  </main>;
}
