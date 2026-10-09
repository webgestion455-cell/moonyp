/**
 * Synchronisation périodique Meta Ads (lecture seule).
 * Appelée par le planificateur toutes les 15 minutes. Protégée par CRON_SECRET.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/meta-ads-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["CRON_SECRET"] || process.env["LOVABLE_CRON_SECRET"];
        if (!secret || request.headers.get("x-cron-secret") !== secret) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { runMetaSync } = await import("@/lib/meta-ads.server");
        const result = await runMetaSync("cron", null);
        return Response.json(result);
      },
    },
  },
});
