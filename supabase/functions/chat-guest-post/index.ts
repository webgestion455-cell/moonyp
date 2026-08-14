/// <reference lib="deno.ns" />
// -------------------------------------------------------------------------
// BNP PARIBAS — Chat GUEST : envoyer un message dans un ticket guest
// Body: { conversationId, message, wantHandoff? }
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const { conversationId, message, lang = "fr" } = await req.json();
    if (!conversationId || !message) {
      return new Response(JSON.stringify({ error: "conversationId+message required" }), {
        status: 400,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const { data: conv } = await supabaseAdmin
      .from("chat_conversations")
      .select("id, is_guest, status, guest_name")
      .eq("id", conversationId)
      .single();
    if (!conv || !conv.is_guest) {
      return new Response(JSON.stringify({ error: "not_found" }), {
        status: 404,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const clean = String(message).trim().slice(0, 2000);
    await supabaseAdmin.from("chat_messages").insert({
      conversation_id: conv.id,
      sender_type: "client",
      sender_name: conv.guest_name ?? "Visiteur",
      format: "text",
      content_html: `<p>${clean.replace(/</g, "&lt;").replace(/\n/g, "<br/>")}</p>`,
      content_text: clean,
    });

    // Appel IA si pas encore assigné à un agent
    if (conv.status !== "assigned") {
      try {
        const aiResp = await fetch(
          `${Deno.env.get("SUPABASE_URL")}/functions/v1/chat-ai`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            },
            body: JSON.stringify({ message: clean, history: [], lang }),
          },
        );
        const aiData = await aiResp.json();
        const html = String(aiData?.html ?? "");
        const handoff = Boolean(aiData?.handoff);
        if (html) {
          await supabaseAdmin.from("chat_messages").insert({
            conversation_id: conv.id,
            sender_type: "bot",
            sender_name: "Anna",
            format: "html",
            content_html: html,
            content_text: html.replace(/<[^>]+>/g, " "),
            meta: handoff ? { handoff: true } : null,
          });
        }
      } catch (e) {
        console.error("ai", e);
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
