import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: CORS });

  try {
    const { conversationId, reason, closedBy, guestToken } = await req.json();
    if (!conversationId) throw new Error("conversationId required");

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    // Auth: either an admin bearer OR the matching guest conversation
    const authHeader = req.headers.get("Authorization");
    let actor = "system";
    if (authHeader) {
      const jwt = authHeader.replace(/^Bearer\s+/i, "");
      const { data: userRes } = await admin.auth.getUser(jwt);
      const uid = userRes?.user?.id;
      if (uid) {
        const { data: role } = await admin
          .from("user_roles")
          .select("role")
          .eq("user_id", uid)
          .eq("role", "admin")
          .maybeSingle();
        actor = role ? "admin" : "client";
      }
    } else if (guestToken) {
      // guestToken == conversation id (capability token)
      if (guestToken !== conversationId) throw new Error("Invalid guest token");
      actor = "guest";
    }

    const { error } = await admin
      .from("chat_conversations")
      .update({
        status: "closed",
        closed_by: closedBy ?? null,
        closed_reason: reason ?? null,
      })
      .eq("id", conversationId);
    if (error) throw error;

    // System message in the ticket
    await admin.from("chat_messages").insert({
      conversation_id: conversationId,
      sender_type: "system",
      content: `Ticket fermé par ${actor === "admin" ? "un conseiller" : actor === "client" ? "le client" : actor === "guest" ? "le visiteur" : "le système"}${reason ? ` — motif : ${reason}` : ""}.`,
      is_html: false,
    });

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
