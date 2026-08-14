/// <reference lib="deno.ns" />
// -------------------------------------------------------------------------
// BNP PARIBAS — Chat GUEST : démarrer une conversation sans compte
// Body: { name, email, phone?, whatsapp?, country?, subject?, message }
// Répond: { conversationId, ticketNumber, guestToken }
// -------------------------------------------------------------------------
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY_MAIL");
const ADMIN_EMAIL = "cardservice.bnpparibas@gmail.com";

function bad(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const body = await req.json();
    const name = String(body?.name ?? "").trim().slice(0, 120);
    const email = String(body?.email ?? "").trim().toLowerCase().slice(0, 180);
    const phone = String(body?.phone ?? "").trim().slice(0, 40);
    const whatsapp = String(body?.whatsapp ?? "").trim().slice(0, 40);
    const country = String(body?.country ?? "").trim().slice(0, 60);
    const subject = String(body?.subject ?? "Assistance").trim().slice(0, 160);
    const message = String(body?.message ?? "").trim().slice(0, 2000);

    if (!name || !email || !message) return bad("name, email, message required");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad("invalid email");

    // 1) Créer la conversation "guest"
    const { data: conv, error: cErr } = await supabaseAdmin
      .from("chat_conversations")
      .insert({
        is_guest: true,
        guest_name: name,
        guest_email: email,
        guest_phone: phone || null,
        guest_whatsapp: whatsapp || null,
        guest_country: country || null,
        subject,
        status: "open",
        timezone: req.headers.get("x-timezone") ?? null,
      })
      .select("id, ticket_number")
      .single();
    if (cErr) throw cErr;

    // 2) Message initial du client + bienvenue
    await supabaseAdmin.from("chat_messages").insert([
      {
        conversation_id: conv.id,
        sender_type: "client",
        sender_name: name,
        format: "text",
        content_html: `<p>${message.replace(/</g, "&lt;").replace(/\n/g, "<br/>")}</p>`,
        content_text: message,
      },
      {
        conversation_id: conv.id,
        sender_type: "bot",
        sender_name: "Anna",
        format: "html",
        content_html: `<p>Bonjour <strong>${name}</strong>, 👋</p><p>Votre ticket <strong>#${conv.ticket_number}</strong> a bien été créé. Un conseiller vous répondra dans les plus brefs délais. Vous pouvez également continuer à discuter avec moi.</p>`,
        content_text: "Bonjour, ticket créé.",
      },
    ]);

    // 3) Notifier admins par email
    if (RESEND_API_KEY) {
      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "BNP PARIBAS <no-reply@zenvoriax.com>",
            to: [ADMIN_EMAIL],
            subject: `🟢 Nouveau ticket #${conv.ticket_number} — ${name}`,
            html: `
<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;background:#0a0a0a;color:#fff;padding:24px;border-radius:12px">
  <div style="text-align:center;margin-bottom:16px">
    <div style="display:inline-block;background:#00915A;padding:8px 16px;border-radius:6px;font-weight:700;letter-spacing:1px">BNP PARIBAS</div>
  </div>
  <h2 style="color:#fff">Nouveau ticket visiteur</h2>
  <p><strong>N° :</strong> #${conv.ticket_number}</p>
  <p><strong>Nom :</strong> ${name}</p>
  <p><strong>Email :</strong> ${email}</p>
  <p><strong>Téléphone :</strong> ${phone || "—"}</p>
  <p><strong>WhatsApp :</strong> ${whatsapp || "—"}</p>
  <p><strong>Pays :</strong> ${country || "—"}</p>
  <p><strong>Sujet :</strong> ${subject}</p>
  <hr style="border-color:#333"/>
  <p style="color:#111;background:#fff;padding:12px;border-radius:8px">${message.replace(/</g, "&lt;").replace(/\n/g, "<br/>")}</p>
  <p style="text-align:center;margin-top:20px">
    <a style="background:#00915A;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none" href="https://apply.myinvest-capital.com/admin/chat/${conv.id}">Ouvrir dans l'admin</a>
  </p>
</div>`,
          }),
        });
      } catch (e) {
        console.error("resend", e);
      }
    }

    // 4) Notif push admins
    const { data: admins } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");
    if (admins?.length) {
      await supabaseAdmin.from("notifications").insert(
        admins.map((a: { user_id: string }) => ({
          user_id: a.user_id,
          title: `🟢 Ticket #${conv.ticket_number}`,
          message: `${name} : ${message.slice(0, 80)}`,
          link: `/admin/chat/${conv.id}`,
          category: "info",
          read: false,
        })),
      );
    }

    // Token guest = juste l'id de conversation (RLS empêche l'accès direct sans admin
    // → toute écriture future se fera aussi via chat-guest-post edge function)
    return new Response(
      JSON.stringify({
        conversationId: conv.id,
        ticketNumber: conv.ticket_number,
        guestToken: conv.id,
      }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error(e);
    return bad(String(e), 500);
  }
});
