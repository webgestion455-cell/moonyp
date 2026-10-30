import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Bold, CheckCircle2, Italic, Link2, MessageCircle, Send, RefreshCw, UserRound, Underline, Paperclip } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/admin/chat")({ component: SupportInbox });
type Conversation = { id: string; guest_name: string | null; guest_email: string | null; subject: string | null; ticket_number: string | null; status: string; agent_name: string | null; unread_for_admin: number; last_message_at: string };
type ChatMessage = { id: string; sender: string; sender_name: string | null; content: string; sender_avatar_url: string | null; signature: string | null; created_at: string };
function localDate(value: string) { return new Intl.DateTimeFormat(undefined, { month: "short", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(new Date(value)); }
function shortName(value?: string | null) { return (value || "Client").trim().split(" ")[0] || "Client"; }
function safeMessageHtml(value: string) {
  value = value.replace(/&amp;nbsp;|&nbsp;|&#160;|&#xA0;/gi, " ");
  const escape = (s: string) => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  if (!/<(strong|b|em|i|u|a|br|p|div|ul|ol|li|img)\b/i.test(value)) {
    return escape(value).replace(/(https?:\/\/[^\s<]+|www\.[^\s<]+)/g, (url) => {
      const href = url.startsWith("www.") ? "https://" + url : url;
      return '<a href="' + href.replace(/"/g,"%22") + '" target="_blank" rel="noopener noreferrer">' + url + '</a>';
    }).replace(/\n/g,"<br>");
  }
  return value.replace(/<\/?(script|style|iframe|object|svg)[^>]*>/gi,"")
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,"")
    .replace(/javascript\s*:/gi,"")
    .replace(/<(?!\/?(?:strong|b|em|i|u|a|br|p|div|ul|ol|li|img)\b)[^>]*>/gi,"")
    .replace(/<img\b([^>]*)>/gi, (_m, attrs) => {
      const match = attrs.match(/src\s*=\s*(["'])(.*?)\1/i);
      const base = (import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, "") + "/storage/v1/object/public/support-attachments/";
      if (!match || !match[2].startsWith(base)) return "";
      return '<img src="' + escape(match[2]) + '" alt="Image jointe" loading="lazy" class="my-2 block h-auto max-h-80 max-w-full rounded-xl border object-contain" />';
    })
    .replace(/<(a)\b([^>]*)>/gi, (_m, tag, attrs) => {
      const match = attrs.match(/href\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i);
      if (!match) return "<a>";
      const href = match[1].replace(/^["']|["']$/g,"");
      if (!/^https?:\/\//i.test(href)) return "<a>";
      return '<a href="' + escape(href) + '" target="_blank" rel="noopener noreferrer">';
    });
}
function MessageText({ value }: { value: string }) {
  return <div className="whitespace-pre-wrap break-words [&_a]:text-primary [&_a]:underline [&_strong]:font-bold [&_em]:italic [&_u]:underline" dangerouslySetInnerHTML={{ __html: safeMessageHtml(value) }} />;
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
  const messagesRef = useRef<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState("open");
  const [busy, setBusy] = useState(false);
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [pendingImagePreview, setPendingImagePreview] = useState("");
  const [error, setError] = useState("");
  const editor = useRef<HTMLDivElement>(null);
  const [formatting, setFormatting] = useState({ bold: false, italic: false, underline: false });
  const transcript = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const shouldAutoScroll = useRef(true);
  const loadList = useCallback(async () => {
    try { const data = await support("list", { status: filter }); setItems(data.conversations ?? []); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Impossible de charger les conversations."); }
  }, [filter]);
  const loadMessages = useCallback(async () => {
    if (!selected) return;
    try { const data = await support("messages", { conversationId: selected.id }); const incoming: ChatMessage[] = data.messages ?? []; const current = transcript.current; const nearBottom = !current || current.scrollHeight - current.scrollTop - current.clientHeight < 100; const changed = incoming.length !== messagesRef.current.length || incoming.some((m, i) => m.id !== messagesRef.current[i]?.id || m.content !== messagesRef.current[i]?.content); if (changed) { shouldAutoScroll.current = nearBottom; messagesRef.current = incoming; setMessages(incoming); } }
    catch (e) { setError(e instanceof Error ? e.message : "Impossible de charger les messages."); }
  }, [selected?.id]);
  useEffect(() => { void loadList(); const id = window.setInterval(() => void loadList(), 5000); return () => window.clearInterval(id); }, [loadList]);
  useEffect(() => { void loadMessages(); const id = window.setInterval(() => void loadMessages(), 3000); return () => window.clearInterval(id); }, [loadMessages]);
  useEffect(() => {
    // Realtime updates refresh the inbox immediately; polling remains as a resilient fallback.
    const channel = supabase.channel("moonyp-support-inbox-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages" }, () => {
        void loadList();
        void loadMessages();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_conversations" }, () => {
        void loadList();
        void loadMessages();
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadList, loadMessages]);
  useEffect(() => {
    stickToBottom.current = true;
    shouldAutoScroll.current = true;
    requestAnimationFrame(() => { if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight; });
  }, [selected?.id]);
  useEffect(() => {
    if (!shouldAutoScroll.current) return;
    requestAnimationFrame(() => { if (transcript.current && shouldAutoScroll.current) transcript.current.scrollTop = transcript.current.scrollHeight; });
  }, [messages]);
  function toggleFormat(command: "bold" | "italic" | "underline" | "createLink") {
    const el = editor.current; if (!el) return;
    el.focus();
    if (command === "createLink") {
      const selected = window.getSelection()?.toString();
      const url = window.prompt("Adresse du lien (https://…) ", selected?.startsWith("www.") ? "https://" + selected : selected || "https://");
      if (url) document.execCommand("createLink", false, /^https?:\/\//i.test(url) ? url : "https://" + url);
    } else document.execCommand(command, false);
    setDraft(el.innerHTML);
    setFormatting({ bold: document.queryCommandState("bold"), italic: document.queryCommandState("italic"), underline: document.queryCommandState("underline") });
  }
  function chooseImage(file?: File) {
    if (!file) return;
    if (!["image/jpeg","image/png","image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) { setError("Choisissez une image JPG, PNG ou WebP de 5 Mo maximum."); return; }
    setError(""); setPendingImage(file); setPendingImagePreview(URL.createObjectURL(file));
  }
  function removePendingImage() {
    if (pendingImagePreview) URL.revokeObjectURL(pendingImagePreview);
    setPendingImage(null); setPendingImagePreview("");
  }
  useEffect(() => () => { if (pendingImagePreview) URL.revokeObjectURL(pendingImagePreview); }, [pendingImagePreview]);
  async function uploadPendingImage(file: File) {
    if (!selected) throw new Error("Aucune conversation sélectionnée.");
    const signed = await support("attachment_upload_url", { conversationId: selected.id, fileName: file.name, contentType: file.type });
    const { error: uploadError } = await supabase.storage.from("support-attachments").uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;
    return supabase.storage.from("support-attachments").getPublicUrl(signed.path).data.publicUrl;
  }
  async function send() {
    if (!selected || (!editor.current?.innerText.trim() && !pendingImage) || busy) return;
    setBusy(true); setError("");
    try {
      let content = editor.current?.innerHTML || draft;
      if (pendingImage) {
        const imageUrl = await uploadPendingImage(pendingImage);
        content = (editor.current?.innerText.trim() ? content : "") + '<p><img src="' + imageUrl + '" alt="Image jointe" /></p>';
      }
      await support("send", { conversationId: selected.id, message: content, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      setDraft(""); if (editor.current) editor.current.innerHTML = ""; removePendingImage(); await loadMessages(); await loadList();
    } catch (e) { setError(e instanceof Error ? e.message : "Envoi impossible."); }
    finally { setBusy(false); }
  }
  function onImageSelected(file?: File) { chooseImage(file); }
  async function close() {
    if (!selected) return;
    try { await support("close", { conversationId: selected.id }); await loadList(); setSelected({ ...selected, status: "closed" }); }
    catch (e) { setError(e instanceof Error ? e.message : "Fermeture impossible."); }
  }
  return <main className={selected ? "relative z-0 mx-auto flex h-[calc(100dvh-7rem)] min-h-[520px] w-full max-w-[1600px] flex-col overflow-hidden bg-background p-0" : "mx-auto max-w-[1500px] space-y-4 px-3 py-4 sm:px-5 sm:py-6"}>
    <header className={`${selected ? "hidden" : "flex"} flex-wrap items-center justify-between gap-3`}><div><p className="text-xs font-semibold uppercase tracking-[.22em] text-primary">MOONYP · Assistance</p><h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Centre de support</h1><p className="mt-1 text-sm text-muted-foreground">Conversations clients, réponses et suivi en direct.</p></div><Button variant="outline" size="sm" onClick={() => { void loadList(); void loadMessages(); }}><RefreshCw className="mr-2 h-4 w-4"/>Actualiser</Button></header>
    {error && <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
    <div className={`grid min-h-0 flex-1 gap-3 ${selected ? "grid-cols-1" : "lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]"}`}>
      <Card className={`min-h-0 overflow-hidden ${selected ? "hidden" : "flex flex-col"}`}>
        <CardHeader className="shrink-0 border-b p-4"><CardTitle className="flex items-center gap-2 text-base"><MessageCircle className="h-4 w-4"/>Conversations <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs">{items.length}</span></CardTitle><div className="flex flex-wrap gap-1.5 pt-2">{["open","waiting_agent","closed","all"].map(s=><button key={s} onClick={()=>setFilter(s)} className={`rounded-full px-3 py-1.5 text-xs ${filter===s?"bg-black text-white":"bg-muted text-muted-foreground"}`}>{({open:"Ouvertes",waiting_agent:"En attente",closed:"Clôturées",all:"Toutes"} as Record<string,string>)[s]}</button>)}</div></CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-y-auto p-0">{items.map(c=><button key={c.id} onClick={()=>{setSelected(c);setMessages([]);messagesRef.current=[];}} className={`block w-full border-b p-3 text-left transition hover:bg-muted/50 sm:p-4 ${selected?.id===c.id?"bg-muted":""}`}><span className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground"><UserRound className="h-5 w-5"/></span><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2 font-medium"><span className="truncate">{shortName(c.guest_name)}</span>{c.unread_for_admin>0&&<span className="rounded-full bg-black px-2 py-0.5 text-[10px] text-white">{c.unread_for_admin}</span>}</span><span className="block truncate text-sm text-muted-foreground">{c.subject||"Demande d'assistance"}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{c.ticket_number||c.id.slice(0,8)} · {localDate(c.last_message_at)}</span></span></span></button>)}{!items.length&&<p className="p-8 text-center text-sm text-muted-foreground">Aucune conversation dans ce filtre.</p>}</CardContent>
      </Card>
      <Card className={`min-h-0 flex-col overflow-hidden ${selected ? "flex h-full w-full rounded-none border-0" : "hidden lg:flex"}`}>
        {selected ? <><CardHeader className="shrink-0 border-b p-3 sm:p-4"><div className="flex items-center gap-3"><Button variant="ghost" size="icon" aria-label="Retour aux conversations" onClick={()=>setSelected(null)}><ArrowLeft className="h-5 w-5"/></Button><span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted"><UserRound className="h-5 w-5 text-muted-foreground"/></span><div className="min-w-0 flex-1"><CardTitle className="truncate text-base">{shortName(selected.guest_name)}</CardTitle><p className="mt-1 truncate text-xs text-muted-foreground">{selected.ticket_number} · {selected.guest_email||"Visiteur"} · {selected.status}</p></div>{selected.status!=="closed"&&<Button variant="outline" size="sm" onClick={close}><CheckCircle2 className="mr-1.5 h-4 w-4"/><span className="hidden sm:inline">Clôturer</span></Button>}</div></CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col p-0"><div ref={transcript} onScroll={e=>{const el=e.currentTarget;const nearBottom=el.scrollHeight-el.scrollTop-el.clientHeight<100;stickToBottom.current=nearBottom;shouldAutoScroll.current=nearBottom;}} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">{messages.map(m=><article key={m.id} className="flex gap-3 border-b border-dotted border-border/80 pb-5 pt-1 last:border-0 last:pb-0 sm:gap-4 sm:pb-6"><div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">{m.sender==="agent" ? <img src={m.sender_avatar_url || "/icon-192.png"} alt="" className="h-full w-full object-cover"/> : <UserRound className="h-5 w-5 text-muted-foreground"/>}</div><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{shortName(m.sender_name||selected.guest_name)}{m.sender==="agent"?" (MOONYP)":""}</p><p className="mt-1 text-xs text-muted-foreground">{localDate(m.created_at)}</p><div className="mt-3 text-sm leading-6"><MessageText value={m.content}/></div>{m.sender==="agent"&&m.signature&&<div className="mt-6 space-y-5 text-sm leading-6">{m.signature.replaceAll("\\n", "\n").split(/\n+/).filter(Boolean).map((line,index)=><p key={`${m.id}-signature-${index}`} className={index===1?"font-medium":index===2?"tracking-wide":""}>{line}</p>)}</div>}</div></article>)}{!messages.length&&<p className="py-10 text-center text-sm text-muted-foreground">Chargement des messages…</p>}</div>
          {selected.status!=="closed"&&<form className="shrink-0 border-t bg-background p-3 pb-[calc(.75rem+env(safe-area-inset-bottom))] sm:p-4" onSubmit={e=>{e.preventDefault();void send();}}><div className="mb-2 flex flex-wrap items-center gap-1 rounded-lg border bg-muted/30 p-1"><button type="button" title="Gras" aria-pressed={formatting.bold} onMouseDown={e=>e.preventDefault()} onClick={()=>toggleFormat("bold")} className={`rounded-md p-2 hover:bg-muted ${formatting.bold?"bg-black text-white shadow-sm":""}`}><Bold className="h-4 w-4"/></button><button type="button" title="Italique" aria-pressed={formatting.italic} onMouseDown={e=>e.preventDefault()} onClick={()=>toggleFormat("italic")} className={`rounded-md p-2 hover:bg-muted ${formatting.italic?"bg-black text-white shadow-sm":""}`}><Italic className="h-4 w-4"/></button><button type="button" title="Souligné" aria-pressed={formatting.underline} onMouseDown={e=>e.preventDefault()} onClick={()=>toggleFormat("underline")} className={`rounded-md p-2 hover:bg-muted ${formatting.underline?"bg-black text-white shadow-sm":""}`}><Underline className="h-4 w-4"/></button><button type="button" title="Insérer un lien" onMouseDown={e=>e.preventDefault()} onClick={()=>toggleFormat("createLink")} className="rounded-md p-2 hover:bg-muted"><Link2 className="h-4 w-4"/></button><label className="flex cursor-pointer items-center gap-1 rounded-md p-2 text-xs hover:bg-muted"><input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={busy} onChange={e=>{onImageSelected(e.currentTarget.files?.[0]);e.currentTarget.value="";}}/><Paperclip className="h-4 w-4"/>Joindre une image</label><span className="ml-auto pr-2 text-xs text-muted-foreground">Mise en forme directe</span></div>{pendingImagePreview && <div className="mb-2 flex items-center gap-3 rounded-xl border bg-muted/30 p-2"><img src={pendingImagePreview} alt="Aperçu de la pièce jointe" className="h-14 w-14 rounded-lg object-cover"/><span className="min-w-0 flex-1 truncate text-xs">{pendingImage?.name}</span><button type="button" onClick={removePendingImage} className="rounded-lg px-2 py-1 text-sm hover:bg-muted">Retirer</button></div>}<div ref={editor} contentEditable suppressContentEditableWarning onInput={e=>setDraft(e.currentTarget.innerHTML)} onKeyUp={()=>setFormatting({bold:document.queryCommandState("bold"),italic:document.queryCommandState("italic"),underline:document.queryCommandState("underline")})} onMouseUp={()=>setFormatting({bold:document.queryCommandState("bold"),italic:document.queryCommandState("italic"),underline:document.queryCommandState("underline")})} role="textbox" aria-multiline="true" className="max-h-40 min-h-20 w-full overflow-y-auto rounded-xl border bg-background p-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-black/20 [&_a]:text-primary [&_a]:underline [&_strong]:font-bold [&_em]:italic [&_u]:underline" data-placeholder="Écrire une réponse professionnelle…"/><div className="mt-2 flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-muted-foreground">Signature professionnelle ajoutée automatiquement</span><Button type="submit" disabled={busy||(!draft.trim()&&!pendingImage)} className="bg-black text-white hover:bg-black/85"><Send className="mr-2 h-4 w-4"/>Envoyer</Button></div></form>}</CardContent></> : <div className="flex min-h-[50vh] flex-col items-center justify-center p-10 text-center"><MessageCircle className="h-10 w-10 text-muted-foreground"/><h2 className="mt-4 font-semibold">Sélectionne une conversation</h2><p className="mt-1 max-w-sm text-sm text-muted-foreground">Les nouveaux messages apparaissent automatiquement ici.</p></div>}
      </Card>
    </div>
  </main>;
}
