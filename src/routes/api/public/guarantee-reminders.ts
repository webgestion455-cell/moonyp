/**
 * Rappels d'échéance des frais de couverture : garantie ET assurance
 * emprunteur (option « payer ultérieurement »).
 * Appelé par un ordonnanceur externe ; l'appelant doit présenter le secret
 * partagé CRON_SECRET — l'URL publique ne suffit jamais.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/guarantee-reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["CRON_SECRET"];
        if (!secret || request.headers.get("x-cron-secret") !== secret) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { queueEmail, notifyAdmins } = await import("@/lib/workflow.server");

        const today = new Date();
        const horizon = new Date(today.getTime() + 3 * 86_400_000).toISOString().slice(0, 10);

        const { data: rows } = await supabaseAdmin
          .from("application_guarantees")
          .select("id, application_id, fee_amount, currency, scheduled_payment_date, reminder_count, reminder_last_sent_at")
          .eq("client_choice", "pay_later")
          .eq("payment_status", "awaiting_payment")
          .not("scheduled_payment_date", "is", null)
          .lte("scheduled_payment_date", horizon)
          .limit(200);

        let sent = 0;
        for (const row of rows ?? []) {
          const last = row.reminder_last_sent_at ? new Date(row.reminder_last_sent_at).getTime() : 0;
          if (Date.now() - last < 24 * 3600 * 1000) continue;

          const { data: app } = await supabaseAdmin
            .from("loan_applications")
            .select("reference, email, language, first_name")
            .eq("id", row.application_id)
            .maybeSingle();
          if (!app?.email) continue;

          await queueEmail({
            applicationId: row.application_id,
            to: app.email,
            locale: app.language,
            template: "guaranteeReminder",
            vars: {
              reference: app.reference,
              firstName: app.first_name ?? "",
              amount: `${Number(row.fee_amount ?? 0)} ${row.currency ?? "EUR"}`,
              date: String(row.scheduled_payment_date ?? ""),
              reason: "",
            },
          });

          await supabaseAdmin
            .from("application_guarantees")
            .update({
              reminder_count: Number(row.reminder_count ?? 0) + 1,
              reminder_last_sent_at: new Date().toISOString(),
            } as never)
            .eq("id", row.id);

          await notifyAdmins({
            title: app.reference,
            message: "Rappel d'échéance des frais de garantie envoyé",
            link: `/admin/applications/${row.application_id}`,
            category: "guarantee",
          });
          sent += 1;
        }

        /* ------------------------------------------------------------------
         * Assurance emprunteur — même règle que la garantie : un rappel par
         * dossier et par tranche de 24 h, uniquement lorsque le client a
         * programmé son paiement et que les frais ne sont pas encaissés.
         * ---------------------------------------------------------------- */
        const { data: insuranceRows } = await supabaseAdmin
          .from("application_insurances")
          .select(
            "id, application_id, fee_amount, currency, scheduled_payment_date, reminder_count, reminder_last_sent_at",
          )
          .eq("client_choice", "pay_later")
          .eq("payment_status", "awaiting_payment")
          .not("scheduled_payment_date", "is", null)
          .lte("scheduled_payment_date", horizon)
          .limit(200);

        let insuranceSent = 0;
        for (const row of insuranceRows ?? []) {
          const last = row.reminder_last_sent_at ? new Date(row.reminder_last_sent_at).getTime() : 0;
          if (Date.now() - last < 24 * 3600 * 1000) continue;

          const { data: app } = await supabaseAdmin
            .from("loan_applications")
            .select("reference, email, language, first_name")
            .eq("id", row.application_id)
            .maybeSingle();
          if (!app?.email) continue;

          await queueEmail({
            applicationId: row.application_id,
            to: app.email,
            locale: app.language,
            template: "insuranceReminder",
            vars: {
              reference: app.reference,
              firstName: app.first_name ?? "",
              amount: `${Number(row.fee_amount ?? 0)} ${row.currency ?? "EUR"}`,
              date: String(row.scheduled_payment_date ?? ""),
              reason: "",
            },
          });

          await supabaseAdmin
            .from("application_insurances")
            .update({
              reminder_count: Number(row.reminder_count ?? 0) + 1,
              reminder_last_sent_at: new Date().toISOString(),
            } as never)
            .eq("id", row.id);

          await notifyAdmins({
            title: app.reference,
            message: "Rappel d'échéance des frais d'assurance envoyé",
            link: `/admin/applications/${row.application_id}`,
            category: "insurance",
          });
          insuranceSent += 1;
        }

        return Response.json({
          ok: true,
          sent: sent + insuranceSent,
          guarantees: sent,
          insurances: insuranceSent,
        });
      },
    },
  },
});
