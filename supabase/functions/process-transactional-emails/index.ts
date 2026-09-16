import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const resendApiKey = Deno.env.get("RESEND_API_KEY_MAIL")!;

const supabase = createClient(supabaseUrl, serviceRoleKey);
const resend = new Resend(resendApiKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { data: emails, error: fetchError } = await supabase
      .from("transactional_emails")
      .select("id, application_id, to_email, subject, body, payload, status")
      .is("sent_at", null)
      .is("error", null)
      .order("created_at", { ascending: true })
      .limit(20);

    if (fetchError) {
      throw fetchError;
    }

    if (!emails || emails.length === 0) {
      return new Response(
        JSON.stringify({
          ok: true,
          processed: 0,
          message: "Aucun email en attente.",
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    let sent = 0;
    let failed = 0;

    for (const email of emails) {
      try {
        const { error: updateProcessingError } = await supabase
          .from("transactional_emails")
          .update({
            status: "processing",
            error: null,
          })
          .eq("id", email.id)
          .is("sent_at", null);

        if (updateProcessingError) {
          throw updateProcessingError;
        }

        const payload =
          email.payload && typeof email.payload === "object"
            ? email.payload
            : {};

        const text =
          typeof payload.text === "string" ? payload.text : undefined;

        const { data, error } = await resend.emails.send({
          from: "Moonyp <no-reply@moonyp.com>",
          to: [email.to_email],
          subject: email.subject,
          html: email.body,
          ...(text ? { text } : {}),
        });

        if (error) {
          throw new Error(error.message);
        }

        const { error: updateSentError } = await supabase
          .from("transactional_emails")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            error: null,
          })
          .eq("id", email.id);

        if (updateSentError) {
          throw updateSentError;
        }

        console.log(`Email ${email.id} envoyé`, data?.id);

        sent++;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);

        console.error(`Erreur email ${email.id}:`, message);

        await supabase
          .from("transactional_emails")
          .update({
            status: "failed",
            error: message,
          })
          .eq("id", email.id);

        failed++;
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        processed: emails.length,
        sent,
        failed,
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  } catch (error) {
    console.error(error);

    return new Response(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }
});

