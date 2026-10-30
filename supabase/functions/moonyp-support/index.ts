import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as webpush from "npm:web-push@3.6.7";
const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(url, serviceKey);
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Vary": "Origin",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const hash = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))).map(b => b.toString(16).padStart(2,"0")).join("");
const clean = (s: unknown, max = 4000) => String(s ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0,max);
async function authUser(req: Request) {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await db.auth.getUser(token);
  return error ? null : data.user;
}
async function isStaff(userId: string, needed: string) {
  const { data: roles } = await db.from("user_roles").select("role").eq("user_id", userId);
  const roleNames = (roles ?? []).map((x: any) => x.role);
  if (roleNames.includes("super_admin")) return true;
  if (!roleNames.some((x: string) => ["admin","agent"].includes(x))) return false;
  const { data: perms } = await db.from("role_permissions").select("permission_key").in("role", roleNames);
  return (perms ?? []).some((p: any) => p.permission_key === needed);
}
async function sendWebPush(subscriptions: any[], payload: Record<string, unknown>) {
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!publicKey || !privateKey || !subscriptions?.length) return;
  try {
    webpush.setVapidDetails("mailto:support@moonyp.com", publicKey, privateKey);
    await Promise.all(subscriptions.map(async (sub: any) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload));
      } catch (error: any) {
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          await db.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
          await db.from("chat_guest_push_subscriptions").delete().eq("endpoint", sub.endpoint);
        }
      }
    }));
  } catch (error) { console.error("push_delivery_failed", error); }
}
const SIGNATURE_TRANSLATIONS: Record<string, Record<string, string>> = {"fr":{"g":"Cordialement,","customer_support":"Spécialiste du service client","senior_customer_support":"Spécialiste senior du service client","customer_support_supervisor":"Superviseur du service client","support_manager":"Responsable du service client","relationship_manager":"Gestionnaire de clientèle","account_services":"Spécialiste des comptes","payments_specialist":"Spécialiste des paiements","kyc_aml_specialist":"Spécialiste KYC / lutte anti-blanchiment","fraud_risk_analyst":"Analyste fraude et risques","compliance_officer":"Responsable conformité","complaints_specialist":"Spécialiste des réclamations","technical_support":"Spécialiste du support technique","security_specialist":"Spécialiste sécurité","operations_specialist":"Spécialiste des opérations","team_lead":"Chef d’équipe support"},"en":{"g":"Kind regards,","customer_support":"Customer Support Specialist","senior_customer_support":"Senior Customer Support Specialist","customer_support_supervisor":"Customer Support Supervisor","support_manager":"Customer Support Manager","relationship_manager":"Relationship Manager","account_services":"Account Services Specialist","payments_specialist":"Payments Specialist","kyc_aml_specialist":"KYC / Anti-Money Laundering Specialist","fraud_risk_analyst":"Fraud & Risk Analyst","compliance_officer":"Compliance Officer","complaints_specialist":"Complaints Specialist","technical_support":"Technical Support Specialist","security_specialist":"Security Specialist","operations_specialist":"Operations Specialist","team_lead":"Support Team Lead"},"de":{"g":"Freundliche Grüße,","customer_support":"Kundenservice-Spezialist","senior_customer_support":"Senior-Kundenservice-Spezialist","customer_support_supervisor":"Kundenservice-Supervisor","support_manager":"Kundenserviceleitung","relationship_manager":"Kundenbetreuer","account_services":"Kontoservice-Spezialist","payments_specialist":"Zahlungsspezialist","kyc_aml_specialist":"KYC- / Geldwäschepräventionsspezialist","fraud_risk_analyst":"Betrugs- und Risikoanalyst","compliance_officer":"Compliance-Beauftragter","complaints_specialist":"Beschwerdespezialist","technical_support":"Technischer Support-Spezialist","security_specialist":"Sicherheitsspezialist","operations_specialist":"Betriebsspezialist","team_lead":"Teamleiter Support"},"es":{"g":"Atentamente,","customer_support":"Especialista de atención al cliente","senior_customer_support":"Especialista sénior de atención al cliente","customer_support_supervisor":"Supervisor de atención al cliente","support_manager":"Responsable de atención al cliente","relationship_manager":"Gestor de relaciones con clientes","account_services":"Especialista de cuentas","payments_specialist":"Especialista en pagos","kyc_aml_specialist":"Especialista KYC y prevención del blanqueo","fraud_risk_analyst":"Analista de fraude y riesgos","compliance_officer":"Responsable de cumplimiento","complaints_specialist":"Especialista en reclamaciones","technical_support":"Especialista de soporte técnico","security_specialist":"Especialista en seguridad","operations_specialist":"Especialista de operaciones","team_lead":"Líder del equipo de soporte"},"it":{"g":"Cordiali saluti,","customer_support":"Specialista del servizio clienti","senior_customer_support":"Specialista senior del servizio clienti","customer_support_supervisor":"Supervisore del servizio clienti","support_manager":"Responsabile del servizio clienti","relationship_manager":"Gestore delle relazioni con i clienti","account_services":"Specialista dei conti","payments_specialist":"Specialista dei pagamenti","kyc_aml_specialist":"Specialista KYC e antiriciclaggio","fraud_risk_analyst":"Analista frodi e rischi","compliance_officer":"Responsabile della conformità","complaints_specialist":"Specialista reclami","technical_support":"Specialista del supporto tecnico","security_specialist":"Specialista della sicurezza","operations_specialist":"Specialista operativo","team_lead":"Responsabile del team di supporto"},"nl":{"g":"Met vriendelijke groet,","customer_support":"Klantenservicespecialist","senior_customer_support":"Senior klantenservicespecialist","customer_support_supervisor":"Supervisor klantenservice","support_manager":"Manager klantenservice","relationship_manager":"Relatiemanager","account_services":"Accountspecialist","payments_specialist":"Betalingsspecialist","kyc_aml_specialist":"KYC- en antiwitwasspecialist","fraud_risk_analyst":"Fraude- en risicoanalist","compliance_officer":"Compliance officer","complaints_specialist":"Klachtenspecialist","technical_support":"Technisch supportspecialist","security_specialist":"Beveiligingsspecialist","operations_specialist":"Operationeel specialist","team_lead":"Teamleider support"},"sl":{"g":"Lep pozdrav,","customer_support":"Specialist za podporo strankam","senior_customer_support":"Višji specialist za podporo strankam","customer_support_supervisor":"Nadzornik podpore strankam","support_manager":"Vodja podpore strankam","relationship_manager":"Skrbnik odnosov s strankami","account_services":"Specialist za račune","payments_specialist":"Specialist za plačila","kyc_aml_specialist":"Specialist za KYC in preprečevanje pranja denarja","fraud_risk_analyst":"Analitik goljufij in tveganj","compliance_officer":"Pooblaščenec za skladnost","complaints_specialist":"Specialist za pritožbe","technical_support":"Specialist za tehnično podporo","security_specialist":"Varnostni specialist","operations_specialist":"Specialist za operacije","team_lead":"Vodja podporne ekipe"},"bg":{"g":"С уважение,","customer_support":"Специалист обслужване на клиенти","senior_customer_support":"Старши специалист обслужване на клиенти","customer_support_supervisor":"Ръководител обслужване на клиенти","support_manager":"Мениджър обслужване на клиенти","relationship_manager":"Мениджър взаимоотношения с клиенти","account_services":"Специалист клиентски сметки","payments_specialist":"Специалист плащания","kyc_aml_specialist":"Специалист KYC и противодействие на изпирането на пари","fraud_risk_analyst":"Анализатор измами и риск","compliance_officer":"Служител по съответствието","complaints_specialist":"Специалист жалби","technical_support":"Специалист техническа поддръжка","security_specialist":"Специалист сигурност","operations_specialist":"Оперативен специалист","team_lead":"Ръководител екип поддръжка"},"sk":{"g":"S pozdravom,","customer_support":"Špecialista zákazníckej podpory","senior_customer_support":"Senior špecialista zákazníckej podpory","customer_support_supervisor":"Vedúci zákazníckej podpory","support_manager":"Manažér zákazníckej podpory","relationship_manager":"Manažér vzťahov so zákazníkmi","account_services":"Špecialista klientskych účtov","payments_specialist":"Špecialista platieb","kyc_aml_specialist":"Špecialista KYC a boja proti praniu špinavých peňazí","fraud_risk_analyst":"Analytik podvodov a rizík","compliance_officer":"Pracovník súladu s predpismi","complaints_specialist":"Špecialista reklamácií","technical_support":"Špecialista technickej podpory","security_specialist":"Bezpečnostný špecialista","operations_specialist":"Špecialista prevádzky","team_lead":"Vedúci tímu podpory"},"el":{"g":"Με εκτίμηση,","customer_support":"Ειδικός εξυπηρέτησης πελατών","senior_customer_support":"Ανώτερος ειδικός εξυπηρέτησης πελατών","customer_support_supervisor":"Επόπτης εξυπηρέτησης πελατών","support_manager":"Υπεύθυνος εξυπηρέτησης πελατών","relationship_manager":"Υπεύθυνος σχέσεων πελατών","account_services":"Ειδικός λογαριασμών","payments_specialist":"Ειδικός πληρωμών","kyc_aml_specialist":"Ειδικός KYC και καταπολέμησης νομιμοποίησης εσόδων","fraud_risk_analyst":"Αναλυτής απάτης και κινδύνων","compliance_officer":"Υπεύθυνος κανονιστικής συμμόρφωσης","complaints_specialist":"Ειδικός παραπόνων","technical_support":"Ειδικός τεχνικής υποστήριξης","security_specialist":"Ειδικός ασφάλειας","operations_specialist":"Ειδικός λειτουργιών","team_lead":"Επικεφαλής ομάδας υποστήριξης"},"fi":{"g":"Ystävällisin terveisin,","customer_support":"Asiakaspalvelun asiantuntija","senior_customer_support":"Asiakaspalvelun vanhempi asiantuntija","customer_support_supervisor":"Asiakaspalvelun esihenkilö","support_manager":"Asiakaspalvelupäällikkö","relationship_manager":"Asiakkuuspäällikkö","account_services":"Tilipalveluiden asiantuntija","payments_specialist":"Maksamisen asiantuntija","kyc_aml_specialist":"KYC- ja rahanpesun torjunnan asiantuntija","fraud_risk_analyst":"Petos- ja riskianalyytikko","compliance_officer":"Vaatimustenmukaisuudesta vastaava","complaints_specialist":"Reklamaatioasiantuntija","technical_support":"Teknisen tuen asiantuntija","security_specialist":"Tietoturva-asiantuntija","operations_specialist":"Operatiivinen asiantuntija","team_lead":"Tukitiimin vetäjä"},"ro":{"g":"Cu stimă,","customer_support":"Specialist servicii clienți","senior_customer_support":"Specialist senior servicii clienți","customer_support_supervisor":"Supervizor servicii clienți","support_manager":"Manager servicii clienți","relationship_manager":"Manager relații cu clienții","account_services":"Specialist conturi","payments_specialist":"Specialist plăți","kyc_aml_specialist":"Specialist KYC și prevenirea spălării banilor","fraud_risk_analyst":"Analist fraudă și risc","compliance_officer":"Responsabil conformitate","complaints_specialist":"Specialist reclamații","technical_support":"Specialist suport tehnic","security_specialist":"Specialist securitate","operations_specialist":"Specialist operațiuni","team_lead":"Coordonator echipă suport"},"pl":{"g":"Z poważaniem,","customer_support":"Specjalista obsługi klienta","senior_customer_support":"Starszy specjalista obsługi klienta","customer_support_supervisor":"Kierownik obsługi klienta","support_manager":"Menedżer obsługi klienta","relationship_manager":"Opiekun relacji z klientami","account_services":"Specjalista ds. kont","payments_specialist":"Specjalista ds. płatności","kyc_aml_specialist":"Specjalista KYC i przeciwdziałania praniu pieniędzy","fraud_risk_analyst":"Analityk oszustw i ryzyka","compliance_officer":"Specjalista ds. zgodności","complaints_specialist":"Specjalista ds. reklamacji","technical_support":"Specjalista wsparcia technicznego","security_specialist":"Specjalista ds. bezpieczeństwa","operations_specialist":"Specjalista ds. operacyjnych","team_lead":"Lider zespołu wsparcia"},"hr":{"g":"Srdačan pozdrav,","customer_support":"Stručnjak korisničke podrške","senior_customer_support":"Viši stručnjak korisničke podrške","customer_support_supervisor":"Nadzornik korisničke podrške","support_manager":"Voditelj korisničke podrške","relationship_manager":"Voditelj odnosa s klijentima","account_services":"Stručnjak za račune","payments_specialist":"Stručnjak za plaćanja","kyc_aml_specialist":"Stručnjak za KYC i sprječavanje pranja novca","fraud_risk_analyst":"Analitičar prijevara i rizika","compliance_officer":"Službenik za usklađenost","complaints_specialist":"Stručnjak za pritužbe","technical_support":"Stručnjak tehničke podrške","security_specialist":"Stručnjak za sigurnost","operations_specialist":"Stručnjak za operacije","team_lead":"Voditelj tima podrške"},"hu":{"g":"Üdvözlettel,","customer_support":"Ügyfélszolgálati szakértő","senior_customer_support":"Senior ügyfélszolgálati szakértő","customer_support_supervisor":"Ügyfélszolgálati csoportvezető","support_manager":"Ügyfélszolgálati vezető","relationship_manager":"Ügyfélkapcsolati menedzser","account_services":"Számlaszolgáltatási szakértő","payments_specialist":"Fizetési szakértő","kyc_aml_specialist":"KYC- és pénzmosás-megelőzési szakértő","fraud_risk_analyst":"Csalás- és kockázatelemző","compliance_officer":"Megfelelőségi vezető","complaints_specialist":"Panaszkezelési szakértő","technical_support":"Műszaki támogatási szakértő","security_specialist":"Biztonsági szakértő","operations_specialist":"Műveleti szakértő","team_lead":"Támogatási csoportvezető"}};
function translatedSignature(localeValue: string, profile: any, senderName: string) {
  const locale = (localeValue || "fr").toLowerCase().split(/[-_]/)[0];
  const dictionary = SIGNATURE_TRANSLATIONS[locale] || SIGNATURE_TRANSLATIONS.fr;
  const rawTitle = String(profile?.job_title || "customer_support").trim();
  const legacyTitles: Record<string, string> = {
    "Spécialiste du service client": "customer_support",
    "Spécialiste senior du service client": "senior_customer_support",
    "Superviseur du service client": "customer_support_supervisor",
    "Responsable du service client": "support_manager",
    "Gestionnaire de clientèle": "relationship_manager",
    "Spécialiste des comptes": "account_services",
    "Spécialiste des paiements": "payments_specialist",
    "Spécialiste KYC / lutte anti-blanchiment": "kyc_aml_specialist",
    "Analyste fraude et risques": "fraud_risk_analyst",
    "Responsable conformité": "compliance_officer",
    "Spécialiste des réclamations": "complaints_specialist",
    "Spécialiste du support technique": "technical_support",
    "Spécialiste sécurité": "security_specialist",
    "Spécialiste des opérations": "operations_specialist",
    "Chef d’équipe support": "team_lead"
  };
  const roleKey = legacyTitles[rawTitle] || rawTitle;
  const title = dictionary[roleKey] || rawTitle || dictionary.customer_support;
  const firstName = String(profile?.display_name || senderName).trim().split(/\s+/)[0] || "Support";
  return [dictionary.g, firstName + " | " + title, "MOONYP"].join("\n\n");
}
async function canAccess(conv: any, user: any, guestToken?: string) {
  if (user) {
    if (await isStaff(user.id, "chat.view")) return { ok: true, staff: true };
    if (conv.user_id === user.id) return { ok: true, staff: false };
    // A guest conversation may remain open after the visitor signs in.
    // Never let a guest token override ownership by a different account.
    if (conv.user_id) return { ok: false, staff: false };
  }
  if (!guestToken || !conv.guest_token) return { ok: false, staff: false };
  return { ok: await hash(guestToken) === await hash(conv.guest_token), staff: false };
}
Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return reply({ error: "method_not_allowed" }, 405);
  if (origin && !(origin === "https://moonyp.com" || origin.endsWith(".moonyp.com") || origin === "http://localhost:5173")) return reply({ error: "origin_not_allowed" }, 403);
  try {
    const body = await req.json();
    const action = clean(body.action, 40);
    const user = await authUser(req);
    if (action === "config") return reply({ vapidPublicKey: Deno.env.get("VAPID_PUBLIC_KEY") || null, pushConfigured: Boolean(Deno.env.get("VAPID_PUBLIC_KEY") && Deno.env.get("VAPID_PRIVATE_KEY")) });
    if (action === "start") {
      const name = clean(body.name, 100);
      const email = clean(body.email, 254).toLowerCase();
      const message = clean(body.message, 4000);
      if (!name || !message) return reply({ error: "name_and_message_required" }, 400);
      const token = crypto.randomUUID() + crypto.randomUUID();
      const ticket = "MY-" + crypto.randomUUID().replace(/-/g,"").slice(0,8).toUpperCase();
      const { data: conv, error } = await db.from("chat_conversations").insert({
        user_id: user?.id ?? null, guest_token: token, guest_name: name, guest_email: email || null,
        locale: clean(body.locale, 12) || "fr", timezone: clean(body.timezone, 80) || "UTC",
        subject: clean(body.subject, 160) || "Demande d'assistance", ticket_number: ticket,
        status: "open", last_message_at: new Date().toISOString(), unread_for_admin: 1
      }).select("id,ticket_number,status,created_at").single();
      if (error || !conv) return reply({ error: "conversation_create_failed" }, 500);
      const { error: msgError } = await db.from("chat_messages").insert({
        conversation_id: conv.id, sender: user ? "customer" : "guest", sender_name: name,
        content: message, content_type: "text", metadata: { timezone: clean(body.timezone,80) || "UTC" }
      });
      if (msgError) { await db.from("chat_conversations").delete().eq("id", conv.id); return reply({ error: "message_create_failed" }, 500); }
      return reply({ conversation: conv, guestToken: token });
    }
    if (action === "list") {
      if (!user || !(await isStaff(user.id, "chat.view"))) return reply({ error: "forbidden" }, 403);
      const status = clean(body.status, 20);
      let q = db.from("chat_conversations").select("id,user_id,guest_name,guest_email,subject,ticket_number,status,agent_id,agent_name,unread_for_admin,unread_for_user,last_message_at,created_at").order("last_message_at", { ascending: false }).limit(100);
      if (status && status !== "all") q = q.eq("status", status);
      const { data, error } = await q;
      if (error) return reply({ error: "conversation_list_failed" }, 500);
      return reply({ conversations: data ?? [] });
    }
    const conversationId = clean(body.conversationId, 80);
    if (!conversationId) return reply({ error: "conversation_id_required" }, 400);
    const { data: conv, error: convError } = await db.from("chat_conversations").select("*").eq("id", conversationId).maybeSingle();
    if (convError || !conv) return reply({ error: "conversation_not_found" }, 404);
    const access = await canAccess(conv, user, clean(body.guestToken, 120));
    if (!access.ok) return reply({ error: "forbidden" }, 403);

    if (action === "attachment_upload_url") {
      if (conv.status === "closed") return reply({ error: "conversation_closed" }, 409);
      if (access.staff && !(await isStaff(user.id, "chat.reply"))) return reply({ error: "reply_forbidden" }, 403);
      const contentType = clean(body.contentType, 80).toLowerCase();
      const extensions: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
      if (!extensions[contentType]) return reply({ error: "unsupported_image_type" }, 400);
      const path = conversationId + "/" + crypto.randomUUID() + "." + extensions[contentType];
      const { data: signed, error: signedError } = await db.storage.from("support-attachments").createSignedUploadUrl(path, { upsert: false });
      if (signedError || !signed?.token) return reply({ error: "attachment_upload_unavailable" }, 500);
      return reply({ path: signed.path || path, token: signed.token });
    }
    if (action === "subscribe_guest") {
      const sub = body.subscription ?? {};
      const endpoint = clean(sub.endpoint, 2000);
      const p256dh = clean(sub.keys?.p256dh, 500);
      const auth = clean(sub.keys?.auth, 500);
      if (user || !endpoint.startsWith("https://") || !p256dh || !auth) return reply({ error: "invalid_subscription" }, 400);
      const { error } = await db.from("chat_guest_push_subscriptions").upsert({
        conversation_id: conversationId, guest_token_hash: await hash(clean(body.guestToken, 120)),
        endpoint, p256dh, auth, user_agent: clean(req.headers.get("user-agent"), 500)
      }, { onConflict: "endpoint" });
      return error ? reply({ error: "subscription_save_failed" }, 500) : reply({ ok: true });
    }
    if (action === "messages") {
      // Keep the stored conversation language aligned with the language selected by the customer.
      if (!access.staff && body.locale) {
        const requestedLocale = clean(body.locale, 12).toLowerCase().split(/[-_]/)[0];
        const supportedLocales = new Set(["fr","en","de","es","it","nl","sl","bg","sk","el","fi","ro","pl","hr","hu"]);
        if (supportedLocales.has(requestedLocale) && conv.locale !== requestedLocale) {
          await db.from("chat_conversations").update({ locale: requestedLocale }).eq("id", conversationId);
          conv.locale = requestedLocale;
        }
      }
      const { data, error } = await db.from("chat_messages").select("id,conversation_id,sender,sender_name,content,content_type,metadata,sender_avatar_url,signature,created_at").eq("conversation_id", conversationId).order("created_at", { ascending: true }).limit(300);
      if (error) return reply({ error: "messages_load_failed" }, 500);
      if (access.staff) await db.from("chat_conversations").update({ unread_for_admin: 0 }).eq("id", conversationId);
      else await db.from("chat_conversations").update({ unread_for_user: 0 }).eq("id", conversationId);
      return reply({ conversation: { id: conv.id, status: conv.status, ticket_number: conv.ticket_number }, messages: data ?? [] });
    }
    if (action === "send") {
      // Persist the latest customer-selected language before the next agent reply/signature.
      if (!access.staff && body.locale) {
        const requestedLocale = clean(body.locale, 12).toLowerCase().split(/[-_]/)[0];
        const supportedLocales = new Set(["fr","en","de","es","it","nl","sl","bg","sk","el","fi","ro","pl","hr","hu"]);
        if (supportedLocales.has(requestedLocale) && conv.locale !== requestedLocale) {
          await db.from("chat_conversations").update({ locale: requestedLocale }).eq("id", conversationId);
          conv.locale = requestedLocale;
        }
      }
      const content = clean(body.message, 4000);
      if (!content) return reply({ error: "message_required" }, 400);
      if (conv.status === "closed") return reply({ error: "conversation_closed" }, 409);
      if (access.staff && !(await isStaff(user.id, "chat.reply"))) return reply({ error: "reply_forbidden" }, 403);
      const staffProfile = access.staff ? (await db.from("staff_profiles").select("display_name,job_title,avatar_url").eq("user_id", user.id).maybeSingle()).data : null;
      const senderName = access.staff ? clean(staffProfile?.display_name || user.user_metadata?.full_name || user.email?.split("@")[0] || "Équipe support",100) : clean(conv.guest_name || user?.user_metadata?.full_name || "Client",100);
      const signature = access.staff ? translatedSignature(String(conv.locale || "fr"), staffProfile, senderName) : null;
      const { data: msg, error } = await db.from("chat_messages").insert({
        conversation_id: conversationId, sender: access.staff ? "agent" : (user ? "customer" : "guest"),
        sender_name: senderName, content, content_type: "text",
        sender_avatar_url: staffProfile?.avatar_url || null, signature,
        metadata: { timezone: clean(body.timezone,80) || "UTC" }
      }).select("id,conversation_id,sender,sender_name,content,content_type,metadata,sender_avatar_url,signature,created_at").single();
      if (error || !msg) return reply({ error: "message_send_failed" }, 500);
      const updates: Record<string, unknown> = { last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      if (access.staff) { updates.unread_for_user = (conv.unread_for_user || 0) + 1; if (!conv.agent_id) { updates.agent_id = user.id; updates.agent_name = senderName; } }
      else updates.unread_for_admin = (conv.unread_for_admin || 0) + 1;
      await db.from("chat_conversations").update(updates).eq("id", conversationId);
      if (access.staff) {
        if (conv.user_id) {
          const { data: subs } = await db.from("push_subscriptions").select("endpoint,p256dh,auth").eq("user_id", conv.user_id);
          await sendWebPush(subs ?? [], { title: "Réponse du support MOONYP", body: content.slice(0, 180), link: "/support" });
        } else {
          const { data: subs } = await db.from("chat_guest_push_subscriptions").select("endpoint,p256dh,auth").eq("conversation_id", conversationId);
          await sendWebPush(subs ?? [], { title: "Réponse du support MOONYP", body: content.slice(0, 180), link: "/" });
        }
      } else {
        const { data: roles } = await db.from("user_roles").select("user_id").in("role", ["admin", "agent", "super_admin"]);
        const ids = [...new Set((roles ?? []).map((r: any) => r.user_id))];
        if (ids.length) {
          const title = "Nouveau message client · MOONYP";
          const preview = (conv.guest_name || "Client") + ": " + content.replace(/<[^>]*>/g, " ").replace(/\\s+/g, " ").slice(0, 150);
          // Persist in-app notifications so the admin bell updates in real time even if OS push is unavailable.
          await db.from("notifications").insert(ids.map((id: string) => ({
            user_id: id, title, message: preview, link: "/admin/chat", category: "support", read: false
          })));
          const { data: subs } = await db.from("push_subscriptions").select("endpoint,p256dh,auth").in("user_id", ids);
          await sendWebPush(subs ?? [], { title, body: preview, link: "/admin/chat" });
        }
      }
      return reply({ message: msg });
    }
    if (action === "assign") {
      if (!user || !access.staff || !(await isStaff(user.id, "chat.reply"))) return reply({ error: "forbidden" }, 403);
      const target = clean(body.agentId, 80) || user.id;
      const { data: targetRoles } = await db.from("user_roles").select("role").eq("user_id", target);
      if (!(targetRoles ?? []).some((r: any) => ["agent","admin","super_admin"].includes(r.role))) return reply({ error: "invalid_agent" }, 400);
      const { data: profile } = await db.from("staff_profiles").select("display_name").eq("user_id", target).maybeSingle();
      const { error } = await db.from("chat_conversations").update({ agent_id: target, agent_name: profile?.display_name || null, updated_at: new Date().toISOString() }).eq("id", conversationId);
      return error ? reply({ error: "assign_failed" }, 500) : reply({ ok: true });
    }
    if (action === "close") {
      if (!user || !access.staff || !(await isStaff(user.id, "chat.reply"))) return reply({ error: "forbidden" }, 403);
      const { error } = await db.from("chat_conversations").update({ status: "closed", resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", conversationId);
      return error ? reply({ error: "close_failed" }, 500) : reply({ ok: true });
    }
    return reply({ error: "unknown_action" }, 400);
  } catch {
    return reply({ error: "invalid_request" }, 400);
  }
});