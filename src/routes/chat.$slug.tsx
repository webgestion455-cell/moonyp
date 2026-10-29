import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Clock3, LoaderCircle, MessageCircle, Send, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/chat/$slug")({ component: PublicTenantChat });
type Org = { id: string; name: string; slug: string; logo_url: string | null; brand_color: string; accent_color: string; welcome_message: Record<string,string> | null; default_locale: string; enabled_locales: string[]; support_email: string | null };
type Conversation = { id: string; ticket_number: string; status: string; subject?: string; created_at?: string; last_message_at?: string; resolved_at?: string | null };
type Message = { id: string; sender: string; sender_name: string | null; content: string; created_at: string; signature?: string | null };
const LOCALES = ["fr","en","de","es","it","nl","sl","bg","sk","el","fi","ro","pl","hr","hu"];
const TXT: Record<string,Record<string,string>> = {
fr:{title:"Service client",subtitle:"Comment pouvons-nous vous aider ?",name:"Votre nom",email:"E-mail (facultatif)",subject:"Objet de la demande",message:"Votre message",start:"Démarrer la conversation",send:"Envoyer",history:"Mes anciennes conversations",new:"Nouvelle conversation",closed:"Conversation clôturée",open:"En cours",empty:"Aucun message pour le moment.",signin:"Connectez-vous pour retrouver vos conversations sur vos autres appareils.",signIn:"Se connecter",loading:"Chargement…",error:"Une erreur est survenue. Réessayez.",privacy:"Échange sécurisé avec le service client de",welcome:"Bienvenue ! Envoyez-nous un message et notre équipe vous répondra.",ticket:"Référence"},
en:{title:"Customer support",subtitle:"How can we help you?",name:"Your name",email:"Email (optional)",subject:"Subject",message:"Your message",start:"Start conversation",send:"Send",history:"My previous conversations",new:"New conversation",closed:"Conversation closed",open:"In progress",empty:"No messages yet.",signin:"Sign in to retrieve your conversations across devices.",signIn:"Sign in",loading:"Loading…",error:"Something went wrong. Please try again.",privacy:"Secure support conversation with",welcome:"Welcome! Send us a message and our team will reply.",ticket:"Reference"},
de:{title:"Kundendienst",subtitle:"Wie können wir Ihnen helfen?",name:"Ihr Name",email:"E-Mail (optional)",subject:"Betreff",message:"Ihre Nachricht",start:"Gespräch starten",send:"Senden",history:"Meine früheren Gespräche",new:"Neues Gespräch",closed:"Gespräch geschlossen",open:"In Bearbeitung",empty:"Noch keine Nachrichten.",signin:"Melden Sie sich an, um Gespräche auf anderen Geräten zu sehen.",signIn:"Anmelden",loading:"Wird geladen…",error:"Ein Fehler ist aufgetreten. Bitte erneut versuchen.",privacy:"Sicherer Support-Chat mit",welcome:"Willkommen! Schreiben Sie uns, unser Team antwortet Ihnen.",ticket:"Referenz"},
es:{title:"Atención al cliente",subtitle:"¿Cómo podemos ayudarte?",name:"Tu nombre",email:"Correo electrónico (opcional)",subject:"Asunto",message:"Tu mensaje",start:"Iniciar conversación",send:"Enviar",history:"Mis conversaciones anteriores",new:"Nueva conversación",closed:"Conversación cerrada",open:"En curso",empty:"Todavía no hay mensajes.",signin:"Inicia sesión para recuperar tus conversaciones en otros dispositivos.",signIn:"Iniciar sesión",loading:"Cargando…",error:"Se produjo un error. Inténtalo de nuevo.",privacy:"Conversación segura con atención al cliente de",welcome:"¡Bienvenido! Envíanos un mensaje y nuestro equipo responderá.",ticket:"Referencia"},
it:{title:"Assistenza clienti",subtitle:"Come possiamo aiutarti?",name:"Il tuo nome",email:"E-mail (facoltativa)",subject:"Oggetto",message:"Il tuo messaggio",start:"Avvia conversazione",send:"Invia",history:"Le mie conversazioni precedenti",new:"Nuova conversazione",closed:"Conversazione chiusa",open:"In corso",empty:"Nessun messaggio per ora.",signin:"Accedi per ritrovare le conversazioni su altri dispositivi.",signIn:"Accedi",loading:"Caricamento…",error:"Si è verificato un errore. Riprova.",privacy:"Conversazione sicura con l'assistenza di",welcome:"Benvenuto! Inviaci un messaggio e il nostro team risponderà.",ticket:"Riferimento"},
nl:{title:"Klantenservice",subtitle:"Hoe kunnen we je helpen?",name:"Je naam",email:"E-mail (optioneel)",subject:"Onderwerp",message:"Je bericht",start:"Gesprek starten",send:"Verzenden",history:"Mijn eerdere gesprekken",new:"Nieuw gesprek",closed:"Gesprek gesloten",open:"In behandeling",empty:"Nog geen berichten.",signin:"Log in om gesprekken op andere apparaten terug te vinden.",signIn:"Inloggen",loading:"Laden…",error:"Er ging iets mis. Probeer het opnieuw.",privacy:"Veilig supportgesprek met",welcome:"Welkom! Stuur ons een bericht, ons team reageert zo snel mogelijk.",ticket:"Referentie"},
sl:{title:"Podpora strankam",subtitle:"Kako vam lahko pomagamo?",name:"Vaše ime",email:"E-pošta (neobvezno)",subject:"Zadeva",message:"Vaše sporočilo",start:"Začni pogovor",send:"Pošlji",history:"Moji prejšnji pogovori",new:"Nov pogovor",closed:"Pogovor je zaključen",open:"V teku",empty:"Za zdaj ni sporočil.",signin:"Prijavite se za dostop do pogovorov v drugih napravah.",signIn:"Prijava",loading:"Nalaganje…",error:"Prišlo je do napake. Poskusite znova.",privacy:"Varen pogovor s podporo podjetja",welcome:"Dobrodošli! Pošljite nam sporočilo in odgovorila vam bo naša ekipa.",ticket:"Referenca"},
bg:{title:"Обслужване на клиенти",subtitle:"Как можем да ви помогнем?",name:"Вашето име",email:"Имейл (по избор)",subject:"Тема",message:"Вашето съобщение",start:"Започни разговор",send:"Изпрати",history:"Предишните ми разговори",new:"Нов разговор",closed:"Разговорът е приключен",open:"В процес",empty:"Все още няма съобщения.",signin:"Влезте, за да виждате разговорите си на други устройства.",signIn:"Вход",loading:"Зареждане…",error:"Възникна грешка. Опитайте отново.",privacy:"Сигурен разговор с поддръжката на",welcome:"Добре дошли! Изпратете съобщение и екипът ни ще отговори.",ticket:"Референция"},
sk:{title:"Zákaznícka podpora",subtitle:"Ako vám môžeme pomôcť?",name:"Vaše meno",email:"E-mail (nepovinné)",subject:"Predmet",message:"Vaša správa",start:"Začať konverzáciu",send:"Odoslať",history:"Moje predchádzajúce konverzácie",new:"Nová konverzácia",closed:"Konverzácia uzavretá",open:"Prebieha",empty:"Zatiaľ žiadne správy.",signin:"Prihláste sa, aby ste našli konverzácie aj na iných zariadeniach.",signIn:"Prihlásiť sa",loading:"Načítava sa…",error:"Nastala chyba. Skúste to znova.",privacy:"Zabezpečená konverzácia s podporou",welcome:"Vitajte! Napíšte nám a náš tím vám odpovie.",ticket:"Referencia"},
el:{title:"Εξυπηρέτηση πελατών",subtitle:"Πώς μπορούμε να σας βοηθήσουμε;",name:"Το όνομά σας",email:"Email (προαιρετικό)",subject:"Θέμα",message:"Το μήνυμά σας",start:"Έναρξη συνομιλίας",send:"Αποστολή",history:"Προηγούμενες συνομιλίες μου",new:"Νέα συνομιλία",closed:"Η συνομιλία έκλεισε",open:"Σε εξέλιξη",empty:"Δεν υπάρχουν ακόμη μηνύματα.",signin:"Συνδεθείτε για να βρείτε τις συνομιλίες σας σε άλλες συσκευές.",signIn:"Σύνδεση",loading:"Φόρτωση…",error:"Παρουσιάστηκε σφάλμα. Δοκιμάστε ξανά.",privacy:"Ασφαλής συνομιλία υποστήριξης με",welcome:"Καλώς ήρθατε! Στείλτε μας μήνυμα και η ομάδα μας θα απαντήσει.",ticket:"Αναφορά"},
fi:{title:"Asiakastuki",subtitle:"Miten voimme auttaa?",name:"Nimesi",email:"Sähköposti (valinnainen)",subject:"Aihe",message:"Viestisi",start:"Aloita keskustelu",send:"Lähetä",history:"Aiemmat keskusteluni",new:"Uusi keskustelu",closed:"Keskustelu suljettu",open:"Käynnissä",empty:"Ei vielä viestejä.",signin:"Kirjaudu sisään nähdäksesi keskustelusi muilla laitteilla.",signIn:"Kirjaudu sisään",loading:"Ladataan…",error:"Tapahtui virhe. Yritä uudelleen.",privacy:"Suojattu tukikeskustelu yrityksen",welcome:"Tervetuloa! Lähetä viesti, niin tiimimme vastaa.",ticket:"Viite"},
ro:{title:"Asistență clienți",subtitle:"Cu ce vă putem ajuta?",name:"Numele dvs.",email:"E-mail (opțional)",subject:"Subiect",message:"Mesajul dvs.",start:"Începe conversația",send:"Trimite",history:"Conversațiile mele anterioare",new:"Conversație nouă",closed:"Conversație închisă",open:"În desfășurare",empty:"Nu există mesaje încă.",signin:"Autentificați-vă pentru a accesa conversațiile pe alte dispozitive.",signIn:"Autentificare",loading:"Se încarcă…",error:"A apărut o eroare. Încercați din nou.",privacy:"Conversație securizată cu suportul",welcome:"Bun venit! Trimiteți-ne un mesaj, iar echipa noastră va răspunde.",ticket:"Referință"},
pl:{title:"Obsługa klienta",subtitle:"Jak możemy pomóc?",name:"Twoje imię",email:"E-mail (opcjonalnie)",subject:"Temat",message:"Twoja wiadomość",start:"Rozpocznij rozmowę",send:"Wyślij",history:"Moje poprzednie rozmowy",new:"Nowa rozmowa",closed:"Rozmowa zamknięta",open:"W toku",empty:"Brak wiadomości.",signin:"Zaloguj się, aby odzyskać rozmowy na innych urządzeniach.",signIn:"Zaloguj się",loading:"Ładowanie…",error:"Wystąpił błąd. Spróbuj ponownie.",privacy:"Bezpieczna rozmowa z obsługą",welcome:"Witamy! Wyślij wiadomość, a nasz zespół odpowie.",ticket:"Numer"},
hr:{title:"Korisnička podrška",subtitle:"Kako vam možemo pomoći?",name:"Vaše ime",email:"E-pošta (neobavezno)",subject:"Predmet",message:"Vaša poruka",start:"Započni razgovor",send:"Pošalji",history:"Moji prethodni razgovori",new:"Novi razgovor",closed:"Razgovor je zatvoren",open:"U tijeku",empty:"Još nema poruka.",signin:"Prijavite se za pristup razgovorima na drugim uređajima.",signIn:"Prijava",loading:"Učitavanje…",error:"Došlo je do pogreške. Pokušajte ponovno.",privacy:"Siguran razgovor s korisničkom podrškom",welcome:"Dobro došli! Pošaljite nam poruku i naš tim će odgovoriti.",ticket:"Referenca"},
hu:{title:"Ügyfélszolgálat",subtitle:"Miben segíthetünk?",name:"Az Ön neve",email:"E-mail (nem kötelező)",subject:"Tárgy",message:"Üzenete",start:"Beszélgetés indítása",send:"Küldés",history:"Korábbi beszélgetéseim",new:"Új beszélgetés",closed:"Beszélgetés lezárva",open:"Folyamatban",empty:"Még nincs üzenet.",signin:"Jelentkezzen be, hogy más eszközökön is elérje beszélgetéseit.",signIn:"Bejelentkezés",loading:"Betöltés…",error:"Hiba történt. Próbálja újra.",privacy:"Biztonságos ügyfélszolgálati beszélgetés:",welcome:"Üdvözöljük! Küldjön üzenetet, csapatunk válaszolni fog.",ticket:"Hivatkozás"}
};
function PublicTenantChat() {
  const { slug } = Route.useParams();
  const [org,setOrg] = useState<Org|null>(null);
  const [locale,setLocale] = useState("fr");
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [name,setName] = useState("");
  const [email,setEmail] = useState("");
  const [subject,setSubject] = useState("");
  const [draft,setDraft] = useState("");
  const [conversation,setConversation] = useState<Conversation|null>(null);
  const [guestToken,setGuestToken] = useState("");
  const [messages,setMessages] = useState<Message[]>([]);
  const [history,setHistory] = useState<Conversation[]>([]);
  const [signedIn,setSignedIn] = useState(false);
  const [showHistory,setShowHistory] = useState(false);
  const t = TXT[locale] ?? TXT.en;
  const key = useMemo(()=>`tenant-chat:${slug}`,[slug]);
  const call = useCallback(async (action:string, extra:Record<string,unknown>={}) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const { data, error: invokeError } = await supabase.functions.invoke("tenant-support", {
      body:{action,slug,...extra,locale},
      headers: sessionData.session?.access_token ? {Authorization:`Bearer ${sessionData.session.access_token}`} : {}
    });
    if(invokeError) throw invokeError;
    if(data?.error) throw new Error(data.error);
    return data;
  },[slug,locale]);

  useEffect(()=>{
    let active=true;
    (async()=>{
      setLoading(true);
      try {
        const cfg=await call("config");
        if(!active)return;
        setOrg(cfg.organization);
        const supported=(cfg.organization.enabled_locales||[]).filter((l:string)=>LOCALES.includes(l));
        const browser=(navigator.language||"en").toLowerCase().split("-")[0];
        setLocale(supported.includes(browser)?browser:cfg.organization.default_locale||"en");
        const {data:{user}}=await supabase.auth.getUser();
        setSignedIn(Boolean(user));
        const saved=localStorage.getItem(key);
        if(saved){
          try {
            const parsed=JSON.parse(saved);
            if(parsed?.conversation?.id && parsed?.guestToken){
              setConversation(parsed.conversation); setGuestToken(parsed.guestToken);
              const res=await supabase.functions.invoke("tenant-support",{body:{action:"messages",slug,conversationId:parsed.conversation.id,guestToken:parsed.guestToken,locale:cfg.organization.default_locale||"en"}});
              if(!res.error&&!res.data?.error){setMessages(res.data.messages||[]);setConversation((prev)=>prev?{...prev,...res.data.conversation}:res.data.conversation);}
            }
          } catch { localStorage.removeItem(key); }
        }
      } catch(e){ if(active)setError(e instanceof Error?e.message:"Entreprise introuvable ou chat indisponible."); }
      finally { if(active)setLoading(false); }
    })();
    return()=>{active=false};
  },[slug,key]);

  const loadMessages=useCallback(async()=>{
    if(!conversation||(!guestToken&&!signedIn))return;
    try {
      const res=await call("messages",{conversationId:conversation.id,guestToken});
      setMessages(res.messages||[]);
      if(res.conversation)setConversation(prev=>prev?{...prev,...res.conversation}:res.conversation);
    } catch {}
  },[conversation?.id,guestToken,signedIn,call]);
  useEffect(()=>{if(!conversation)return;void loadMessages();const id=window.setInterval(()=>void loadMessages(),4000);return()=>window.clearInterval(id)},[loadMessages,conversation?.id]);

  async function start(e:React.FormEvent){
    e.preventDefault();setBusy(true);setError("");
    try {
      const res=await call("start",{name,email,subject,message:draft,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone});
      setConversation(res.conversation);setGuestToken(res.guestToken);setMessages([]);
      localStorage.setItem(key,JSON.stringify({conversation:res.conversation,guestToken:res.guestToken}));
      setDraft("");
      const loaded=await supabase.functions.invoke("tenant-support",{body:{action:"messages",slug,conversationId:res.conversation.id,guestToken:res.guestToken,locale}});
      if(!loaded.error&&!loaded.data?.error)setMessages(loaded.data.messages||[]);
    }catch(e){setError(e instanceof Error?e.message:t.error)}
    finally{setBusy(false)}
  }
  async function send(e:React.FormEvent){
    e.preventDefault();if(!draft.trim()||!conversation||conversation.status==="closed")return;
    setBusy(true);setError("");
    try{await call("send",{conversationId:conversation.id,guestToken,message:draft,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone});setDraft("");await loadMessages();}
    catch(e){setError(e instanceof Error?e.message:t.error)}
    finally{setBusy(false)}
  }
  async function loadHistory(){
    try{const res=await call("history");setHistory(res.conversations||[]);setShowHistory(true)}
    catch(e){setError(e instanceof Error?e.message:t.error)}
  }
  async function openHistory(item:Conversation){
    setBusy(true);setError("");
    try{
      const {data:{session}}=await supabase.auth.getSession();
      const res=await supabase.functions.invoke("tenant-support",{body:{action:"messages",slug,conversationId:item.id,locale},headers:session?.access_token?{Authorization:`Bearer ${session.access_token}`}:{}});
      if(res.error||res.data?.error)throw new Error(res.data?.error||"Impossible de charger cette conversation.");
      setConversation(item);setMessages(res.data.messages||[]);setGuestToken("");setShowHistory(false);
    }catch(e){setError(e instanceof Error?e.message:t.error)}finally{setBusy(false)}
  }

  if(loading)return <div className="min-h-screen grid place-items-center"><LoaderCircle className="h-8 w-8 animate-spin"/></div>;
  if(!org)return <main className="min-h-screen grid place-items-center p-6"><div className="max-w-md text-center"><MessageCircle className="mx-auto h-10 w-10 text-muted-foreground"/><h1 className="mt-4 text-2xl font-bold">Chat indisponible</h1><p className="mt-2 text-muted-foreground">{error||"Cette entreprise n’a pas activé son service de support public."}</p></div></main>;
  const accent=org.brand_color||"#166534";
  const welcome=(org.welcome_message&&((org.welcome_message as Record<string,string>)[locale]||(org.welcome_message as Record<string,string>).en))||t.welcome;
  return <main className="min-h-screen px-3 py-5 sm:px-6 sm:py-10" style={{background:"#f5f7fa",fontFamily:"Inter,system-ui,sans-serif"}}>
    <div className="mx-auto max-w-2xl overflow-hidden rounded-2xl border bg-white shadow-xl">
      <header className="flex items-center gap-3 px-5 py-5 text-white sm:px-7" style={{background:accent}}>
        {org.logo_url?<img src={org.logo_url} alt={org.name} className="h-12 w-12 rounded-xl bg-white object-contain p-1"/>:<div className="grid h-12 w-12 place-items-center rounded-xl bg-white/15"><MessageCircle className="h-6 w-6"/></div>}
        <div className="min-w-0 flex-1"><h1 className="truncate text-xl font-bold">{org.name}</h1><p className="text-sm text-white/80">{t.title}</p></div>
        <select aria-label="Language" className="max-w-28 rounded-lg border border-white/30 bg-white/10 p-2 text-sm text-white" value={locale} onChange={e=>setLocale(e.target.value)}>{(org.enabled_locales||[]).filter(l=>LOCALES.includes(l)).map(l=><option key={l} value={l} className="text-black">{l.toUpperCase()}</option>)}</select>
      </header>
      <section className="space-y-5 p-5 sm:p-7">
        {error&&<div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {!conversation&&!showHistory&&<><div><h2 className="text-xl font-semibold">{t.subtitle}</h2><p className="mt-2 text-sm text-slate-600">{welcome}</p></div>
          <form onSubmit={start} className="space-y-4">
            <div className="space-y-1.5"><Label>{t.name}</Label><Input value={name} onChange={e=>setName(e.target.value)} required maxLength={100}/></div>
            <div className="space-y-1.5"><Label>{t.email}</Label><Input type="email" value={email} onChange={e=>setEmail(e.target.value)} maxLength={254}/></div>
            <div className="space-y-1.5"><Label>{t.subject}</Label><Input value={subject} onChange={e=>setSubject(e.target.value)} maxLength={160}/></div>
            <div className="space-y-1.5"><Label>{t.message}</Label><Textarea value={draft} onChange={e=>setDraft(e.target.value)} required maxLength={4000} rows={4}/></div>
            <Button type="submit" disabled={busy} className="w-full text-white" style={{background:accent}}><Send className="mr-2 h-4 w-4"/>{busy?t.loading:t.start}</Button>
          </form>
          <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">{t.signin} <a className="font-semibold underline" href="/auth">{t.signIn}</a></div>
          {signedIn&&<Button variant="outline" className="w-full" onClick={loadHistory}>{t.history}</Button>}
        </>}
        {showHistory&&<div className="space-y-3"><Button variant="ghost" onClick={()=>setShowHistory(false)}><ArrowLeft className="mr-2 h-4 w-4"/>Retour</Button><h2 className="text-lg font-semibold">{t.history}</h2>{history.length===0?<p className="text-sm text-muted-foreground">Aucune conversation enregistrée.</p>:history.map(item=><button key={item.id} onClick={()=>void openHistory(item)} className="flex w-full items-center gap-3 rounded-xl border p-4 text-left hover:bg-slate-50"><MessageCircle className="h-5 w-5 shrink-0" style={{color:accent}}/><span className="min-w-0 flex-1"><span className="block truncate font-medium">{item.subject||item.ticket_number}</span><span className="text-xs text-muted-foreground">{item.ticket_number} · {new Date(item.last_message_at||item.created_at||Date.now()).toLocaleString()}</span></span><span className="text-xs">{item.status==="closed"?t.closed:t.open}</span></button>)}</div>}
        {conversation&&!showHistory&&<div className="space-y-4">
          <div className="flex items-start gap-3"><Button variant="ghost" size="icon" onClick={()=>{setConversation(null);setMessages([]);setGuestToken("");localStorage.removeItem(key)}} aria-label={t.new}><ArrowLeft className="h-4 w-4"/></Button><div className="min-w-0 flex-1"><h2 className="font-semibold">{conversation.subject||t.title}</h2><p className="text-xs text-muted-foreground">{t.ticket}: {conversation.ticket_number}</p></div><span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{conversation.status==="closed"?t.closed:t.open}</span></div>
          <div className="max-h-[52vh] min-h-56 space-y-3 overflow-y-auto rounded-xl bg-slate-50 p-3 sm:p-4">{messages.length===0&&<p className="p-6 text-center text-sm text-muted-foreground">{t.empty}</p>}{messages.map(m=><div key={m.id} className={`max-w-[90%] rounded-xl border p-3 ${["guest","customer","user"].includes(m.sender)?"ml-auto border-transparent text-white":"bg-white"}`} style={["guest","customer","user"].includes(m.sender)?{background:accent}:undefined}><p className="mb-1 text-xs opacity-75">{m.sender_name||org.name} · {new Date(m.created_at).toLocaleString()}</p><p className="whitespace-pre-wrap break-words text-sm">{m.content}</p>{m.signature&&<p className="mt-2 whitespace-pre-wrap text-xs opacity-80">{m.signature}</p>}</div>)}</div>
          {conversation.status!=="closed"&&(guestToken||signedIn)&&<form onSubmit={send} className="flex items-end gap-2"><Textarea value={draft} onChange={e=>setDraft(e.target.value)} placeholder={t.message} maxLength={4000} rows={2} required/><Button type="submit" disabled={busy||!draft.trim()} style={{background:accent}} className="text-white"><Send className="h-4 w-4"/></Button></form>}
          {conversation.status==="closed"&&<div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 className="mr-2 inline h-4 w-4"/>{t.closed}</div>}
          {signedIn&&<Button variant="outline" className="w-full" onClick={loadHistory}>{t.history}</Button>}
        </div>}
        <footer className="flex items-center justify-center gap-2 border-t pt-4 text-xs text-slate-500"><ShieldCheck className="h-4 w-4"/>{t.privacy} {org.name}.</footer>
      </section>
    </div>
  </main>;
}
