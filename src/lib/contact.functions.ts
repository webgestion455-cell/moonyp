import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const ContactInput = z.object({
  full_name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(180),
  subject: z.string().trim().min(2).max(180),
  message: z.string().trim().min(10).max(4000),
  user_id: z.string().uuid().nullable().optional(),
  // honeypot: must be empty
  website: z.string().max(0).optional().or(z.literal("")),
});

const TO_EMAIL = "support@bnpparibas.myinvest-capital.com";
const FROM_EMAIL = "BNP PARIBAS <no-reply@zenvoriax.com>";

export const submitContactMessage = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => ContactInput.parse(d))
  .handler(async ({ data }) => {
    // 1) Persist to DB via admin (so anonymous visitors work and admins always see it)
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("contact_messages")
      .insert({
        user_id: data.user_id ?? null,
        full_name: data.full_name,
        email: data.email,
        subject: data.subject,
        message: data.message,
      })
      .select("id")
      .single();

    if (error) throw new Error(error.message);

    // 2) Try to deliver via Resend (connector or RESEND_API_KEY_MAIL env). Soft-fail.
    let emailSent = false;
    const RESEND_API_KEY_MAIL = process.env.RESEND_API_KEY_MAIL;
    if (RESEND_API_KEY_MAIL) {
      try {
        const html = `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
            <h2 style="color:#0a0a0a">BNP PARIBAS — New contact message</h2>
            <p><strong>Name:</strong> ${escapeHtml(data.full_name)}</p>
            <p><strong>Email:</strong> ${escapeHtml(data.email)}</p>
            <p><strong>Subject:</strong> ${escapeHtml(data.subject)}</p>
            <p><strong>Message:</strong></p>
            <pre style="white-space:pre-wrap;background:#f6f6f6;padding:12px;border-radius:8px">${escapeHtml(
              data.message,
            )}</pre>
          </div>`;
        const res = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${RESEND_API_KEY_MAIL}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    from: FROM_EMAIL,
    to: [TO_EMAIL],
    reply_to: data.email,
    subject: `[Contact] ${data.subject}`,
    html,
  }),
});
        emailSent = res.ok;
        if (emailSent && row?.id) {
          await (supabaseAdmin as any).from("contact_messages").update({ sent_email: true }).eq("id", row.id);
        }
      } catch {
        /* silent — message is still persisted */
      }
    }

    return { ok: true, id: row?.id, emailSent };
  });

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
