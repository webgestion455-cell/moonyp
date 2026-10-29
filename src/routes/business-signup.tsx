import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Building2, CheckCircle2, LoaderCircle, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/business-signup")({ component: BusinessSignupPage });

function BusinessSignupPage() {
  const navigate = useNavigate();
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setNotice("");
    if (company.trim().length < 2) { setError("Indiquez le nom de votre entreprise."); return; }
    if (password.length < 10) { setError("Utilisez un mot de passe d’au moins 10 caractères."); return; }
    if (password !== confirmPassword) { setError("Les deux mots de passe ne correspondent pas."); return; }
    setBusy(true);
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: { data: { account_type: "business", company_name: company.trim() }, emailRedirectTo: `${window.location.origin}/auth/callback?next=/workspace` }
      });
      if (signUpError) throw signUpError;
      if (data.session) {
        navigate({ to: "/workspace" });
      } else {
        setNotice("Votre compte a été créé. Vérifiez votre boîte e-mail et confirmez votre adresse avant de vous connecter. Après confirmation, connectez-vous puis ouvrez votre espace entreprise.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Inscription impossible. Réessayez.");
    } finally { setBusy(false); }
  }

  return <main className="grid min-h-screen place-items-center bg-muted/30 px-4 py-10">
    <section className="w-full max-w-lg rounded-2xl border bg-background p-6 shadow-sm sm:p-9">
      <div className="mb-7 flex items-center gap-3"><div className="grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary"><Building2 className="h-6 w-6"/></div><div><p className="text-sm font-medium text-primary">MOONYP · Support multientreprise</p><h1 className="text-2xl font-bold">Inscription entreprise</h1></div></div>
      <p className="mb-6 text-sm text-muted-foreground">Créez votre compte professionnel pour configurer votre espace de support client personnalisé. L’inscription ne crée pas de compte MOONYP financier ni n’accorde d’accès aux données d’autres entreprises.</p>
      {error && <div role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
      {notice && <div role="status" className="mb-4 rounded-lg border border-emerald-600/30 bg-emerald-600/5 p-3 text-sm text-emerald-800"><CheckCircle2 className="mr-2 inline h-4 w-4"/>{notice}</div>}
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2"><Label htmlFor="business-name">Nom de l’entreprise</Label><Input id="business-name" autoComplete="organization" required maxLength={120} value={company} onChange={e=>setCompany(e.target.value)} placeholder="Ex. Nova Finance"/></div>
        <div className="space-y-2"><Label htmlFor="business-email">E-mail professionnel</Label><Input id="business-email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} placeholder="vous@entreprise.com"/></div>
        <div className="space-y-2"><Label htmlFor="business-password">Mot de passe</Label><Input id="business-password" type="password" autoComplete="new-password" required minLength={10} value={password} onChange={e=>setPassword(e.target.value)}/><p className="text-xs text-muted-foreground">10 caractères minimum. Choisissez un mot de passe unique.</p></div>
        <div className="space-y-2"><Label htmlFor="business-confirm">Confirmer le mot de passe</Label><Input id="business-confirm" type="password" autoComplete="new-password" required value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)}/></div>
        <Button className="w-full" type="submit" disabled={busy}>{busy?<><LoaderCircle className="mr-2 h-4 w-4 animate-spin"/>Création du compte…</>:<><Building2 className="mr-2 h-4 w-4"/>Créer mon compte entreprise</>}</Button>
      </form>
      <div className="mt-5 flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0"/><span>Chaque espace d’entreprise est isolé par des contrôles d’accès côté serveur. Ne partagez jamais votre mot de passe.</span></div>
      <p className="mt-6 text-center text-sm text-muted-foreground">Vous avez déjà un compte ? <Link to="/auth" className="font-semibold text-primary underline-offset-4 hover:underline">Se connecter</Link></p>
    </section>
  </main>;
}
