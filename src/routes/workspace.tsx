import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Building2, Copy, ExternalLink, LoaderCircle, Palette, Save, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/workspace")({ component: WorkspacePage });

type Organization = {
  id: string; name: string; slug: string; logo_url: string | null;
  brand_color: string; accent_color: string; support_email: string | null;
  default_locale: string; enabled_locales: string[]; public_chat_enabled: boolean; status: string;
};
const LOCALES = ["fr","en","de","es","it","nl","sl","bg","sk","el","fi","ro","pl","hr","hu"];
const LOCALE_NAMES: Record<string,string> = {en:"English",fr:"Français",de:"Deutsch",es:"Español",it:"Italiano",nl:"Nederlands",sl:"Slovenščina",bg:"Български",sk:"Slovenčina",el:"Ελληνικά",fi:"Suomi",ro:"Română",pl:"Polski",hr:"Hrvatski",hu:"Magyar"};

function WorkspacePage() {
  const [userId, setUserId] = useState("");
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [current, setCurrent] = useState<Organization | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setLoading(true); setError("");
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { window.location.href = "/auth"; return; }
    setUserId(auth.user.id);
    const { data, error: queryError } = await supabase.from("organizations").select("*").order("created_at", { ascending: true });
    if (queryError) setError("Impossible de charger les espaces. Vérifiez la migration multientreprise et les droits de votre compte.");
    const list = (data ?? []) as Organization[];
    setOrganizations(list);
    if (!current && list[0]) setCurrent(list[0]);
    else if (current) setCurrent(list.find(x => x.id === current.id) ?? list[0] ?? null);
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  async function createOrganization() {
    setSaving(true); setError(""); setNotice("");
    const normalized = slug.trim().toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0,60);
    if (name.trim().length < 2 || !normalized) { setError("Saisissez un nom et un identifiant public valide."); setSaving(false); return; }
    const { data, error: rpcError } = await supabase.rpc("create_support_organization", { p_name: name.trim(), p_slug: normalized, p_default_locale: "fr" });
    if (rpcError) setError(rpcError.message.includes("duplicate") ? "Ce lien public est déjà utilisé. Choisissez un autre identifiant." : "Création impossible : " + rpcError.message);
    else { setName(""); setSlug(""); setNotice("Votre espace a été créé."); await load(); if (data?.id) { const { data: org } = await supabase.from("organizations").select("*").eq("id", data.id).maybeSingle(); if (org) setCurrent(org as Organization); } }
    setSaving(false);
  }

  async function saveBrand() {
    if (!current) return;
    setSaving(true); setError(""); setNotice("");
    const { error: updateError } = await supabase.from("organizations").update({
      name: current.name.trim(), logo_url: current.logo_url?.trim() || null,
      brand_color: current.brand_color, accent_color: current.accent_color,
      support_email: current.support_email?.trim() || null,
      default_locale: current.default_locale,
      enabled_locales: current.enabled_locales,
      public_chat_enabled: current.public_chat_enabled
    }).eq("id", current.id);
    if (updateError) setError("Enregistrement impossible : " + updateError.message);
    else setNotice("Identité visuelle enregistrée.");
    setSaving(false);
  }

  const publicUrl = current ? `${window.location.origin}/chat/${current.slug}` : "";
  if (loading) return <div className="min-h-[60vh] grid place-items-center"><LoaderCircle className="h-7 w-7 animate-spin" /></div>;

  return <main className="min-h-screen bg-muted/30 px-4 py-8 sm:px-6 lg:px-10">
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-sm font-medium text-primary">Espace entreprise</p><h1 className="text-3xl font-bold tracking-tight">Votre support client</h1><p className="mt-1 text-muted-foreground">Personnalisez votre marque et préparez votre lien de chat public.</p></div>
        <div className="flex items-center gap-2 rounded-full border bg-background px-3 py-2 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4 text-emerald-600" /> Espaces isolés par entreprise</div>
      </header>

      {error && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
      {notice && <div role="status" className="rounded-lg border border-emerald-600/30 bg-emerald-600/5 p-3 text-sm text-emerald-700">{notice}</div>}

      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardHeader><CardTitle className="flex items-center gap-2"><Building2 className="h-5 w-5" /> Mes entreprises</CardTitle><CardDescription>Chaque espace possède son propre lien et sa propre identité.</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            {organizations.map(org => <button key={org.id} onClick={() => setCurrent(org)} className={`w-full rounded-lg border p-3 text-left transition ${current?.id === org.id ? "border-primary bg-primary/5" : "hover:bg-muted"}`}><span className="block font-medium">{org.name}</span><span className="text-xs text-muted-foreground">/{org.slug}</span></button>)}
            {!organizations.length && <p className="text-sm text-muted-foreground">Vous n’avez pas encore créé d’espace.</p>}
            <div className="my-3 border-t" />
            <Label htmlFor="org-name">Nom de l’entreprise</Label><Input id="org-name" value={name} onChange={e => setName(e.target.value)} placeholder="Ex. Nova Finance" maxLength={120} />
            <Label htmlFor="org-slug">Lien personnalisé</Label><div className="flex items-center gap-1"><span className="text-xs text-muted-foreground">/chat/</span><Input id="org-slug" value={slug} onChange={e => setSlug(e.target.value)} placeholder="nova-finance" maxLength={60} /></div>
            <Button className="w-full" onClick={createOrganization} disabled={saving || !userId}><Building2 className="mr-2 h-4 w-4" /> Créer mon espace</Button>
          </CardContent>
        </Card>

        {current ? <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Palette className="h-5 w-5" /> Identité visuelle</CardTitle><CardDescription>Ces éléments sont destinés à l’expérience client de votre entreprise, pas à la marque MOONYP.</CardDescription></CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label>Nom affiché</Label><Input value={current.name} onChange={e => setCurrent({...current,name:e.target.value})} maxLength={120} /></div>
                <div className="space-y-2"><Label>E-mail du support</Label><Input type="email" value={current.support_email ?? ""} onChange={e => setCurrent({...current,support_email:e.target.value})} placeholder="support@entreprise.com" /></div>
                <div className="space-y-2 sm:col-span-2"><Label>URL du logo</Label><Input value={current.logo_url ?? ""} onChange={e => setCurrent({...current,logo_url:e.target.value})} placeholder="https://entreprise.com/logo.png" /><p className="text-xs text-muted-foreground">Utilisez une URL HTTPS publique. L’envoi direct de fichiers logo sera ajouté ensuite.</p></div>
                <div className="space-y-2"><Label>Couleur principale</Label><div className="flex gap-2"><Input type="color" className="h-10 w-16 p-1" value={current.brand_color} onChange={e => setCurrent({...current,brand_color:e.target.value})} /><Input value={current.brand_color} onChange={e => setCurrent({...current,brand_color:e.target.value})} maxLength={7} /></div></div>
                <div className="space-y-2"><Label>Couleur secondaire</Label><div className="flex gap-2"><Input type="color" className="h-10 w-16 p-1" value={current.accent_color} onChange={e => setCurrent({...current,accent_color:e.target.value})} /><Input value={current.accent_color} onChange={e => setCurrent({...current,accent_color:e.target.value})} maxLength={7} /></div></div>
                <div className="space-y-2"><Label>Langue par défaut</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={current.default_locale} onChange={e => setCurrent({...current,default_locale:e.target.value})}>{LOCALES.map(l => <option key={l} value={l}>{LOCALE_NAMES[l]}</option>)}</select></div>
                <div className="space-y-2"><Label>Chat public</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={String(current.public_chat_enabled)} onChange={e => setCurrent({...current,public_chat_enabled:e.target.value==="true"})}><option value="true">Activé</option><option value="false">Désactivé</option></select></div>
              </div>
              <div className="space-y-2"><Label>Langues disponibles (15)</Label><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{LOCALES.map(l => <label key={l} className="flex items-center gap-2 rounded-md border p-2 text-sm"><input type="checkbox" checked={current.enabled_locales.includes(l)} onChange={e => setCurrent({...current,enabled_locales:e.target.checked ? [...current.enabled_locales,l] : current.enabled_locales.filter(x=>x!==l)})} />{LOCALE_NAMES[l]}</label>)}</div></div>
              <Button onClick={saveBrand} disabled={saving}><Save className="mr-2 h-4 w-4" /> Enregistrer les modifications</Button>
            </CardContent>
          </Card>

          <Card><CardHeader><CardTitle>Lien public du chat</CardTitle><CardDescription>Partagez ce lien avec vos clients. Le chat affichera l’identité de votre entreprise.</CardDescription></CardHeader>
            <CardContent><div className="flex flex-col gap-2 sm:flex-row"><Input readOnly value={publicUrl} /><Button variant="outline" onClick={() => navigator.clipboard.writeText(publicUrl)}><Copy className="mr-2 h-4 w-4" /> Copier</Button><Button variant="outline" onClick={() => window.open(publicUrl,"_blank","noopener,noreferrer")}><ExternalLink className="mr-2 h-4 w-4" /> Aperçu</Button></div><p className="mt-3 text-xs text-muted-foreground">Le lien devient pleinement opérationnel lorsque le service de chat public multi-entreprise est déployé.</p></CardContent>
          </Card>
        </div> : <Card><CardContent className="p-8 text-center text-muted-foreground">Créez ou sélectionnez un espace entreprise pour configurer son identité.</CardContent></Card>}
      </div>
    </div>
  </main>;
}
