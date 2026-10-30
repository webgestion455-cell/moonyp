import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "npm:resend@6.12.2";

const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const resendKey = Deno.env.get("RESEND_API_KEY_MAIL");
if (!url || !serviceKey || !resendKey) throw new Error("Missing server configuration");
const db = createClient(url, serviceKey);
const resend = new Resend(resendKey);
const headers = { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "https://moonyp.com", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const normEmail = (v: unknown) => String(v ?? "").trim().toLowerCase().slice(0,254);
const hash = async (v: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)))).map(x=>x.toString(16).padStart(2,"0")).join("");
const validEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return json({ error: "method_not_allowed" },405);
  const origin = req.headers.get("Origin");
  if (origin && origin !== "https://moonyp.com" && origin !== "https://www.moonyp.com" && !origin.startsWith("http://localhost:")) return json({error:"origin_not_allowed"},403);
  try {
    const body = await req.json();
    const action = String(body.action ?? "");
    const email = normEmail(body.email);
    if (!validEmail(email)) return json({error:"Adresse e-mail invalide."},400);

    if (action === "request") {
      const purpose = body.purpose === "signup" ? "signup" : "login";
      const companyName = String(body.companyName ?? "").trim().slice(0,120);
      if (purpose === "signup" && companyName.length < 2) return json({error:"Le nom de l’entreprise est obligatoire."},400);
      const since = new Date(Date.now()-15*60*1000).toISOString();
      const { count } = await db.from("business_email_otp").select("id",{count:"exact",head:true}).eq("email",email).gte("created_at",since);
      if ((count ?? 0) >= 3) return json({error:"Trop de demandes. Réessayez dans 15 minutes."},429);
      const { data: previous } = await db.from("business_email_otp").select("resend_after").eq("email",email).is("consumed_at",null).order("created_at",{ascending:false}).limit(1).maybeSingle();
      if (previous?.resend_after && new Date(previous.resend_after).getTime() > Date.now()) return json({error:"Veuillez patienter avant de demander un nouveau code."},429);
      const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6,"0");
      const codeHash = await hash(email+":"+code+":"+serviceKey);
      const { error: insertError } = await db.from("business_email_otp").insert({email,purpose,code_hash:codeHash,company_name:purpose==="signup"?companyName:null,expires_at:new Date(Date.now()+5*60*1000).toISOString(),resend_after:new Date(Date.now()+60*1000).toISOString()});
      if (insertError) throw insertError;
      const sent = await resend.emails.send({from:"Moonyp <no-reply@moonyp.com>",to:[email],subject:"Votre code de vérification MOONYP",html:`<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:28px;color:#172033"><h2>Vérification de votre adresse</h2><p>Voici votre code à usage unique :</p><div style="font-size:32px;letter-spacing:9px;font-weight:700;padding:18px;background:#f3f5f8;border-radius:12px;text-align:center">${code}</div><p>Ce code expire dans 5 minutes. Ne le communiquez à personne.</p><p>Si vous n’êtes pas à l’origine de cette demande, ignorez ce message.</p></div>`});
      if (sent.error) throw new Error(sent.error.message);
      return json({ok:true,message:"Code envoyé. Vérifiez votre boîte e-mail."});
    }

    if (action === "verify") {
      const code = String(body.code ?? "").replace(/\D/g,"").slice(0,6);
      if (code.length !== 6) return json({error:"Saisissez le code à 6 chiffres."},400);
      const {data: challenge,error:readError}=await db.from("business_email_otp").select("*").eq("email",email).is("consumed_at",null).order("created_at",{ascending:false}).limit(1).maybeSingle();
      if (readError) throw readError;
      if (!challenge || new Date(challenge.expires_at).getTime()<Date.now() || challenge.attempts>=5) return json({error:"Code expiré ou invalide. Demandez un nouveau code."},400);
      const supplied = await hash(email+":"+code+":"+serviceKey);
      if (supplied !== challenge.code_hash) {
        await db.from("business_email_otp").update({attempts:challenge.attempts+1}).eq("id",challenge.id).eq("attempts",challenge.attempts);
        return json({error:"Code incorrect."},400);
      }
      const {data:consumed,error:consumeError}=await db.from("business_email_otp").update({consumed_at:new Date().toISOString()}).eq("id",challenge.id).is("consumed_at",null).select("id").maybeSingle();
      if (consumeError) throw consumeError;
      if (!consumed) return json({error:"Ce code a déjà été utilisé. Demandez un nouveau code."},409);

      let user:any=null;
      let generated=await db.auth.admin.generateLink({type:"magiclink",email});
      if (generated.data?.user) user=generated.data.user;
      if (challenge.purpose==="signup") {
        if (user) return json({error:"Un compte existe déjà avec cette adresse. Connectez-vous."},409);
        const randomPassword = Array.from(crypto.getRandomValues(new Uint8Array(48))).map(x=>x.toString(16).padStart(2,"0")).join("");
        const created=await db.auth.admin.createUser({email,email_confirm:true,password:randomPassword,user_metadata:{account_type:"business",company_name:challenge.company_name}});
        if (created.error) throw created.error;
        user=created.data.user;
        generated=await db.auth.admin.generateLink({type:"magiclink",email});
      } else {
        if (!user) return json({error:"Aucun compte entreprise trouvé pour cette adresse."},404);
        const {data: memberships}=await db.from("organization_members").select("organization_id").eq("user_id",user.id).eq("active",true).limit(1);
        if (user.user_metadata?.account_type!=="business" && !memberships?.length) return json({error:"Ce compte n’est pas un compte entreprise."},403);
      }
      if (generated.error || !generated.data?.properties?.hashed_token) throw generated.error ?? new Error("Session token unavailable");
      return json({ok:true,email,token_hash:generated.data.properties.hashed_token,type:"magiclink",next:challenge.purpose==="signup"?"/auth/callback?next=/workspace":"/workspace"});
    }
    return json({error:"unknown_action"},400);
  } catch (e) {
    console.error("business_otp_error",e);
    return json({error:"Une erreur est survenue. Réessayez."},500);
  }
});
