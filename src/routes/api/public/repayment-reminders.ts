/**
 * Notifications d'échéance de remboursement.
 * Marque les échéances dépassées « en retard » et envoie un rappel au client
 * pour les échéances à venir sous 5 jours. Protégé par CRON_SECRET.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/repayment-reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["CRON_SECRET"];
        if (!secret || request.headers.get("x-cron-secret") !== secret) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { queueEmail, notifyAdmins, applyTransition } = await import("@/lib/workflow.server");

        const today = new Date().toISOString().slice(0, 10);
        const horizon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);

        // 1. Échéances dépassées et non soldées → en retard
        const { data: overdue } = await supabaseAdmin
          .from("repayment_schedule")
          .select("id, application_id, installment_no")
          .lt("due_date", today)
          .eq("paid", false)
          .in("status", ["upcoming", "partially_paid"])
          .limit(500);

        // Un seul basculement de dossier en « retard » par demande, même si
        // plusieurs échéances sont dépassées : le client reçoit UN email.
        const escalated = new Set<string>();

        for (const row of overdue ?? []) {
          await supabaseAdmin
            .from("repayment_schedule")
            .update({ status: "late" } as never)
            .eq("id", row.id);
          await notifyAdmins({
            title: `Échéance ${row.installment_no}`,
            message: "Échéance de remboursement en retard",
            link: `/admin/applications/${row.application_id}`,
            category: "repayment",
          });

          if (!escalated.has(row.application_id)) {
            escalated.add(row.application_id);
            const { data: parent } = await supabaseAdmin
              .from("loan_applications")
              .select("status")
              .eq("id", row.application_id)
              .maybeSingle();
            if (parent?.status === "repaying" || parent?.status === "disbursed") {
              // Déclenche la transition « late » → email « paiement en retard ».
              await applyTransition({
                applicationId: row.application_id,
                to: "late",
                actor: "system",
              });
            }
          }
        }


        // 2. Rappels des échéances à venir
        const { data: upcoming } = await supabaseAdmin
          .from("repayment_schedule")
          .select("id, application_id, installment_no, due_date, amount, reminder_sent_at")
          .gte("due_date", today)
          .lte("due_date", horizon)
          .eq("paid", false)
          .is("reminder_sent_at", null)
          .limit(500);

        let sent = 0;
        for (const row of upcoming ?? []) {
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
            template: "installmentReminder",
            vars: {
              reference: app.reference,
              firstName: app.first_name ?? "",
              amount: `${Number(row.amount ?? 0)} EUR`,
              date: String(row.due_date ?? ""),
              reason: "",
            },
          });
          await supabaseAdmin
            .from("repayment_schedule")
            .update({ reminder_sent_at: new Date().toISOString() } as never)
            .eq("id", row.id);
          sent += 1;
        }

        return Response.json({ ok: true, late: (overdue ?? []).length, sent });
      },
    },
  },
});
