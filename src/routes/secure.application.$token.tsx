import { createFileRoute, redirect } from "@tanstack/react-router";
import { resolveLang } from "@/lib/lang-url";

/** Ancienne URL sans langue : on redirige vers la version canonique préfixée. */
export const Route = createFileRoute("/secure/application/$token")({
  beforeLoad: async ({ params }) => {
    throw redirect({
      to: "/$lang/secure/application/$token",
      params: { lang: await resolveLang(), token: params.token },
    });
  },
  component: () => null,
});
