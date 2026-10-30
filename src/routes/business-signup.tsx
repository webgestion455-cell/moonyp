import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Building2, CheckCircle2, LoaderCircle, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/business-signup")({ component: BusinessSignupPage });
function BusinessSignupPage() {
  const navigate=useNavigate();
  const [company,setCompany]=useState(""); const [email,setEmail]=useState(""); const [code,setCode]=useState("");
  const [step,setStep]=useState<"details"|"verify">("details"); const [busy,setBusy]=useState(false); const [error,setError]=useState(""); const [notice,setNotice]=useState("");
  async function functionErrorMessage(error:unknown,fallback:string){const response=(error as {context?:Response})?.context;if(response&&typeof response.clone==="function"){try{const body=await response.clone().json();if(typeof body?.error==="string")return body.error;}catch{}}return error instanceof Error?error.message:fallback;}
  async function requestCode(e:React.FormEvent){e.preventDefault();setBusy(true);setError("");setNotice("");try{
    const {data,error}=await supabase.functions.invoke("business-otp",{body:{action:"request",purpose:"signup",email:email.trim().toLowerCase(),companyName:company.trim()}});
    if(error)throw error;if(data?.error)throw new Error(data.error);setStep("verify");setNotice("Un code à 6 chiffres vient d’être envoyé à votre adresse e-mail.");
  }catch(e){setError(await functionErrorMessage(e,"Impossible d’envoyer le code."));}finally{setBusy(false)}}
  async function verify(e:React.FormEvent){e.preventDefault();setBusy(true);setError("");try{
    const {data,error}=await supabase.functions.invoke("business-otp",{body:{action:"verify",email:email.trim().toLowerCase(),code}});
    if(error)throw error;if(data?.error)throw new Error(data.error);
    const {error:sessionError}=await supabase.auth.verifyOtp({email:email.trim().toLowerCase(),token:data.token_hash,type:"magiclink"});
    if(sessionError)throw sessionError;
    navigate({to:"/auth/callback",search:{next:"/workspace"} as any});
  }catch(e){setError(await functionErrorMessage(e,"Vérification impossible. Demandez un nouveau code."));}finally{setBusy(false)}}
  return <main className="grid min-h-screen place-items-center bg-muted/30 px-4 py-10"><section className="w-full max-w-lg rounded-2xl border bg-background p-6 shadow-sm sm:p-9">
    <div className="mb-7 flex items-center gap-3"><div className="grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary"><Building2 className="h-6 w-6"/></div><div><p className="text-sm font-medium text-primary">MOONYP · Espace entreprise</p><h1 className="text-2xl font-bold">Créer mon compte</h1></div></div>
    <p className="mb-6 text-sm text-muted-foreground">Inscription professionnelle sans mot de passe. Un code à usage unique vérifie votre adresse e-mail.</p>
    {error&&<div role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
    {notice&&<div role="status" className="mb-4 rounded-lg border border-emerald-600/30 bg-emerald-600/5 p-3 text-sm text-emerald-800"><CheckCircle2 className="mr-2 inline h-4 w-4"/>{notice}</div>}
    {step==="details"?<form onSubmit={requestCode} className="space-y-4">
      <div className="space-y-2"><Label htmlFor="company">Nom de l’entreprise</Label><Input id="company" required minLength={2} maxLength={120} value={company} onChange={e=>setCompany(e.target.value)} placeholder="Ex. Nova Finance"/></div>
      <div className="space-y-2"><Label htmlFor="email">E-mail professionnel</Label><Input id="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} placeholder="vous@entreprise.com"/></div>
      <Button className="w-full" type="submit" disabled={busy}>{busy?<><LoaderCircle className="mr-2 h-4 w-4 animate-spin"/>Envoi…</>: "Recevoir mon code"}</Button>
    </form>:<form onSubmit={verify} className="space-y-4">
      <div className="space-y-2"><Label htmlFor="otp">Code de vérification</Label><Input id="otp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,"").slice(0,6))} placeholder="000000" className="text-center text-2xl tracking-[0.4em]"/></div>
      <Button className="w-full" type="submit" disabled={busy||code.length!==6}>{busy?<><LoaderCircle className="mr-2 h-4 w-4 animate-spin"/>Vérification…</>:"Vérifier et créer mon compte"}</Button>
      <Button type="button" variant="ghost" className="w-full" disabled={busy} onClick={()=>{setStep("details");setCode("");setNotice("");}}>Modifier mon adresse</Button>
    </form>}
    <div className="mt-5 flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0"/><span>Code valable 5 minutes, à usage unique. Les espaces d’entreprise restent isolés.</span></div>
    <p className="mt-6 text-center text-sm text-muted-foreground">Déjà inscrit ? <Link to="/business-login" className="font-semibold text-primary underline-offset-4 hover:underline">Connexion par code</Link></p>
  </section></main>;
}