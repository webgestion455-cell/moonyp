/// <reference lib="deno.ns" />
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import * as webpush from "npm:web-push@3.6.7";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function cleanPushText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/<\s*br\s*\/?\s*>|<\s*\/(p|div|li|h[1-6]|tr)\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, " ").replace(/<[^>]*>/g, " ").trim();
}

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

webpush.setVapidDetails(
  "mailto:support@moonyp.com",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

serve(async (req) => {
  try {
    const body = await req.json();

    const { userId, link } = body;
    const authToken = req.headers.get("Authorization")?.replace(/^Bearer\\s+/i, "") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    let actorId: string | null = null;
    if (authToken !== serviceRoleKey) {
      const { data: authData, error: authError } = await supabase.auth.getUser(authToken);
      if (authError || !authData?.user) return new Response("Unauthorized", { status: 401 });
      actorId = authData.user.id;
      if (actorId !== userId) {
        const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", actorId);
        const roleNames = (roles || []).map((row: { role: string }) => row.role);
        if (!roleNames.includes("super_admin")) {
          const { data: perms } = await supabase.from("role_permissions").select("permission_key").in("role", roleNames);
          const allowed = (perms || []).some((row: { permission_key: string }) => ["notifications.send", "chat.reply"].includes(row.permission_key));
          if (!allowed) return new Response("Forbidden", { status: 403 });
        }
      }
    }
    const title = cleanPushText(body?.title);
    const message = cleanPushText(body?.message);
    if (typeof userId !== "string" || !userId || (!title && !message)) return new Response("Invalid notification payload", { status: 400 });

    const { data: subscriptions } = await supabase
      .from("push_subscriptions")
      .select("*")
      .eq("user_id", userId);

    if (!subscriptions?.length) {
      return new Response("No subscriptions", { status: 200 });
    }

    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: {
                p256dh: sub.p256dh,
                auth: sub.auth,
              },
            },
            JSON.stringify({
              title,
              body: message,
              link,
              icon: "/icon-512.png",
              badge: "/icon-192.png",
              tag: typeof body.tag === "string" ? body.tag : title || "MOONYP",
            }),
          );
        } catch (err) {
          console.error(err);
        }
      }),
    );

    return new Response("Push sent", { status: 200 });
  } catch (err) {
    return new Response(String(err), { status: 500 });
  }
});
