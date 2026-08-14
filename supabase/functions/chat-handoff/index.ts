/// <reference lib="deno.ns" />
// -------------------------------------------------------------------------
// BNP PARIBAS — Handoff : notifie les admins par email + push
// Body: { conversationId, userEmail?, userName? }
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
const FROM_EMAIL = "BNP PARIBAS <no-reply@zenvoriax.com>";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const { conversationId, userEmail, userName } = await req.json();
    if (!conversationId) return json({ error: "conversationId required" }, 400);

    // 1) Passe la conversation en "waiting_agent"
    await supabaseAdmin
      .from("chat_conversations")
      .update({ status: "waiting_agent" })
      .eq("id", conversationId);

    // 2) Message système visible dans la conversation
    await supabaseAdmin.from("chat_messages").insert({
      conversation_id: conversationId,
      sender_type: "system",
      sender_name: "Système",
      format: "html",
      content_html:
        "<p><em>Mise en relation avec un conseiller… Un agent va rejoindre la conversation dans 1 à 2 minutes.</em></p>",
      content_text: "Mise en relation avec un conseiller…",
    });

    // 3) Récupère les 10 derniers messages pour l'email admin
    const { data: msgs } = await supabaseAdmin
      .from("chat_messages")
      .select("sender_type, sender_name, content_text, content_html, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(20);

    const recap = (msgs ?? [])
      .map(
        (m) =>
          `<div style="margin:8px 0;padding:8px;border-radius:8px;background:${
            m.sender_type === "client" ? "#e6f4ea" : "#f1f3f4"
          }"><strong>${m.sender_name ?? m.sender_type}</strong> — <span style="color:#666">${new Date(
            m.created_at as string,
          ).toLocaleString("fr-FR")}</span><br/>${m.content_html ?? m.content_text ?? ""}</div>`,
      )
      .join("");

    // 4) Email admin
    let emailSent = false;
    if (RESEND_API_KEY) {
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: FROM_EMAIL,
            to: [ADMIN_EMAIL],
            subject: `🟢 Live Chat — ${userName ?? userEmail ?? "Client"} demande un conseiller`,
            html: `
<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;background:#0a0a0a;color:#fff;padding:24px;border-radius:12px">
  <div style="text-align:center;margin-bottom:16px">
    <div style="display:inline-block;background:#00915A;padding:8px 16px;border-radius:6px;font-weight:700;letter-spacing:1px">BNP PARIBAS</div>
  </div>
  <h2 style="color:#fff">Un client attend un conseiller</h2>
  <p><strong>Client :</strong> ${userName ?? "—"} &lt;${userEmail ?? "—"}&gt;</p>
  <p><strong>Conversation :</strong> <a style="color:#7ecda8" href="https://apply.myinvest-capital.com/admin/chat/${conversationId}">Ouvrir dans l'admin</a></p>
  <hr style="border-color:#333"/>
  <h3 style="color:#fff">Récapitulatif</h3>
  <div style="color:#111">${recap || "<p>(aucun message)</p>"}</div>
  <hr style="border-color:#333;margin-top:24px"/>
  <p style="font-size:12px;color:#999;text-align:center">BNP PARIBAS SA — 16 boulevard des Italiens, 75009 Paris</p>
</div>`,
          }),
        });
        emailSent = res.ok;
      } catch (e) {
        console.error("resend", e);
      }
    }

    // 5) Notifier tous les admins via notifications (push)
    const { data: admins } = await supabaseAdmin.from("user_roles").select("user_id").eq("role", "admin");
    if (admins?.length) {
      await supabaseAdmin.from("notifications").insert(
        admins.map((a: { user_id: string }) => ({
          user_id: a.user_id,
          title: "🟢 Nouveau chat en attente",
          message: `${userName ?? "Un client"} demande un conseiller.`,
          link: `/admin/chat/${conversationId}`,
          category: "info",
          read: false,
        })),
      );
    }

    return json({ ok: true, emailSent });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
