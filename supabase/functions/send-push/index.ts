/// <reference lib="deno.ns" />
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import * as webpush from "npm:web-push@3.6.7";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

webpush.setVapidDetails(
  "mailto:info@myinvest-capital.com",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

serve(async (req) => {
  try {
    const body = await req.json();

    const { userId, title, message, link } = body;

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