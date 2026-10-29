import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(supabaseUrl, serviceRoleKey);
const allowedOrigins = new Set(["https://moonyp.com", "https://www.moonyp.com", "http://localhost:5173"]);
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Vary": "Origin",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: corsHeaders });
const clean = (value: unknown, max = 4000) => String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max);
const sha256 = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))).map(v => v.toString(16).padStart(2, "0")).join("");
const LOCALES = new Set(["fr","en","de","es","it","nl","sl","bg","sk","el","fi","ro","pl","hr","hu"]);

async function getUser(req: Request) {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await db.auth.getUser(token);
  return error ? null : data.user;
}
async function membership(userId: string, organizationId: string, roles?: string[]) {
  let query = db.from("organization_members").select("role,active").eq("user_id", userId).eq("organization_id", organizationId).eq("active", true);
  const { data } = await query.maybeSingle();
  return data && (!roles || roles.includes(data.role)) ? data : null;
}
async function getOrganization(slug: string) {
  const { data } = await db.from("organizations").select("id,name,slug,logo_url,brand_color,accent_color,welcome_message,default_locale,enabled_locales,support_email,public_chat_enabled,status").eq("slug", slug).maybeSingle();
  return data;
}
async function loadConversation(id: string) {
  const { data } = await db.from("chat_conversations").select("id,organization_id,user_id,guest_token,guest_name,guest_email,locale,status,agent_id,agent_name,unread_for_admin,unread_for_user,last_message_at,created_at,subject,ticket_number,resolved_at").eq("id", id).maybeSingle();
  return data;
}
async function authorizeConversation(conv: any, user: any, guestToken: string) {
  if (!conv?.organization_id) return false;
  if (user && conv.user_id === user.id) return true;
  if (user) return Boolean(await membership(user.id, conv.organization_id, ["owner","admin","supervisor","agent","viewer"]));
  if (!guestToken || !conv.guest_token) return false;
  return await sha256(guestToken) === conv.guest_token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const origin = req.headers.get("Origin");
  if (origin && !allowedOrigins.has(origin) && !origin.endsWith(".moonyp.com")) return json({ error: "origin_not_allowed" }, 403);
  try {
    const body = await req.json();
    const action = clean(body.action, 40);
    const user = await getUser(req);
    const slug = clean(body.slug, 60).toLowerCase();

    if (action === "config") {
      if (!slug) return json({ error: "slug_required" }, 400);
      const org = await getOrganization(slug);
      if (!org || org.status !== "active" || !org.public_chat_enabled) return json({ error: "organization_not_available" }, 404);
      return json({ organization: { id: org.id, name: org.name, slug: org.slug, logo_url: org.logo_url, brand_color: org.brand_color, accent_color: org.accent_color, welcome_message: org.welcome_message, default_locale: org.default_locale, enabled_locales: org.enabled_locales, support_email: org.support_email } });
    }

    if (action === "start") {
      if (!slug) return json({ error: "slug_required" }, 400);
      const org = await getOrganization(slug);
      if (!org || org.status !== "active" || !org.public_chat_enabled) return json({ error: "organization_not_available" }, 404);
      const name = clean(body.name, 100);
      const email = clean(body.email, 254).toLowerCase();
      const message = clean(body.message, 4000);
      if (!name || !message) return json({ error: "name_and_message_required" }, 400);
      const locale = clean(body.locale, 12).toLowerCase().split(/[-_]/)[0];
      const chosenLocale = (org.enabled_locales || []).includes(locale) && LOCALES.has(locale) ? locale : org.default_locale;
      const guestToken = crypto.randomUUID() + crypto.randomUUID();
      const { data: conv, error: convError } = await db.from("chat_conversations").insert({
        organization_id: org.id,
        user_id: user?.id ?? null,
        guest_token: await sha256(guestToken),
        guest_name: name,
        guest_email: email || null,
        locale: chosenLocale,
        timezone: clean(body.timezone, 80) || "UTC",
        subject: clean(body.subject, 160) || "Demande d'assistance",
        ticket_number: "TK-" + crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase(),
        status: "open",
        last_message_at: new Date().toISOString(),
        unread_for_admin: 1,
      }).select("id,ticket_number,status,created_at,organization_id").single();
      if (convError || !conv) return json({ error: "conversation_create_failed" }, 500);
      const { error: messageError } = await db.from("chat_messages").insert({
        conversation_id: conv.id, sender: "guest", sender_name: name, content: message, content_type: "text",
        metadata: { timezone: clean(body.timezone, 80) || "UTC" }
      });
      if (messageError) {
        await db.from("chat_conversations").delete().eq("id", conv.id).eq("organization_id", org.id);
        return json({ error: "message_create_failed" }, 500);
      }
      return json({ conversation: conv, guestToken });
    }

    if (action === "list") {
      if (!user) return json({ error: "authentication_required" }, 401);
      const orgId = clean(body.organizationId, 80);
      if (!orgId || !await membership(user.id, orgId, ["owner","admin","supervisor","agent","viewer"])) return json({ error: "forbidden" }, 403);
      const status = clean(body.status, 20);
      let query = db.from("chat_conversations").select("id,organization_id,guest_name,guest_email,subject,ticket_number,status,agent_id,agent_name,unread_for_admin,unread_for_user,last_message_at,created_at").eq("organization_id", orgId).order("last_message_at", { ascending: false }).limit(100);
      if (status && status !== "all") query = query.eq("status", status);
      const { data, error } = await query;
      if (error) return json({ error: "conversation_list_failed" }, 500);
      return json({ conversations: data ?? [] });
    }

    if (action === "history") {
      if (!user) return json({ error: "authentication_required" }, 401);
      if (!slug) return json({ error: "slug_required" }, 400);
      const org = await getOrganization(slug);
      if (!org || org.status !== "active") return json({ error: "organization_not_available" }, 404);
      const { data, error } = await db.from("chat_conversations")
        .select("id,subject,ticket_number,status,locale,last_message_at,created_at,resolved_at")
        .eq("organization_id", org.id).eq("user_id", user.id)
        .order("last_message_at", { ascending: false }).limit(100);
      if (error) return json({ error: "history_load_failed" }, 500);
      return json({ conversations: data ?? [] });
    }

    const conversationId = clean(body.conversationId, 80);
    if (!conversationId) return json({ error: "conversation_id_required" }, 400);
    const conv = await loadConversation(conversationId);
    if (!conv) return json({ error: "conversation_not_found" }, 404);
    const authorized = await authorizeConversation(conv, user, clean(body.guestToken, 120));
    if (!authorized) return json({ error: "forbidden" }, 403);

    if (action === "messages") {
      const requested = clean(body.locale, 12).toLowerCase().split(/[-_]/)[0];
      if (!user && LOCALES.has(requested) && (await getOrganization(slug))?.enabled_locales?.includes(requested) && conv.locale !== requested) {
        await db.from("chat_conversations").update({ locale: requested }).eq("id", conv.id).eq("organization_id", conv.organization_id);
      }
      const { data, error } = await db.from("chat_messages").select("id,conversation_id,sender,sender_name,content,content_type,metadata,created_at,signature,sender_avatar_url").eq("conversation_id", conv.id).order("created_at", { ascending: true }).limit(300);
      if (error) return json({ error: "messages_load_failed" }, 500);
      await db.from("chat_conversations").update(user && conv.user_id !== user.id ? { unread_for_admin: 0 } : { unread_for_user: 0 }).eq("id", conv.id).eq("organization_id", conv.organization_id);
      return json({ conversation: { id: conv.id, status: conv.status, ticket_number: conv.ticket_number, subject: conv.subject }, messages: data ?? [] });
    }

    if (action === "send") {
      if (conv.status === "closed") return json({ error: "conversation_closed" }, 409);
      const message = clean(body.message, 4000);
      if (!message) return json({ error: "message_required" }, 400);
      let sender = "guest";
      let senderName = clean(conv.guest_name || "Client", 100);
      const isCustomer = Boolean(user && conv.user_id === user.id);
      if (user && !isCustomer) {
        const member = await membership(user.id, conv.organization_id, ["owner","admin","supervisor","agent"]);
        if (!member) return json({ error: "reply_forbidden" }, 403);
        sender = "agent";
        const { data: profile } = await db.from("staff_profiles").select("display_name,job_title,avatar_url").eq("user_id", user.id).maybeSingle();
        senderName = clean(profile?.display_name || user.user_metadata?.full_name || user.email?.split("@")[0] || "Support", 100);
      } else if (isCustomer) {
        sender = "customer";
      }
      const { data: msg, error } = await db.from("chat_messages").insert({
        conversation_id: conv.id, sender, sender_name: senderName, content: message, content_type: "text",
        metadata: { timezone: clean(body.timezone, 80) || "UTC" }
      }).select("id,conversation_id,sender,sender_name,content,content_type,metadata,created_at").single();
      if (error || !msg) return json({ error: "message_send_failed" }, 500);
      const updates: Record<string, unknown> = { last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      if (user && conv.user_id !== user.id) {
        updates.unread_for_user = (conv.unread_for_user || 0) + 1;
        if (!conv.agent_id) { updates.agent_id = user.id; updates.agent_name = senderName; }
      } else updates.unread_for_admin = (conv.unread_for_admin || 0) + 1;
      await db.from("chat_conversations").update(updates).eq("id", conv.id).eq("organization_id", conv.organization_id);
      return json({ message: msg });
    }

    if (action === "close") {
      if (!user || !await membership(user.id, conv.organization_id, ["owner","admin","supervisor","agent"])) return json({ error: "forbidden" }, 403);
      const { error } = await db.from("chat_conversations").update({ status: "closed", resolved_at: new Date().toISOString() }).eq("id", conv.id).eq("organization_id", conv.organization_id);
      return error ? json({ error: "close_failed" }, 500) : json({ ok: true });
    }
    return json({ error: "unknown_action" }, 400);
  } catch (error) {
    console.error("tenant_support_request_failed", error);
    return json({ error: "invalid_request" }, 400);
  }
});
