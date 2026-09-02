import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import i18n from "@/i18n";
import { normalizeLang, resolveLang } from "@/lib/lang-url";

export const Route = createFileRoute("/$lang")({
  beforeLoad: async ({ params, location }) => {
    const lang = normalizeLang(params.lang);
    if (!lang) {
      // Segment inconnu : ce n'est pas une langue, on préfixe l'URL demandée.
      throw redirect({ href: `/${await resolveLang()}${location.pathname}${location.searchStr}` });
    }
    if (lang !== params.lang) {
      throw redirect({ href: `/${lang}${location.pathname.slice(params.lang.length + 1)}` });
    }
    // La langue de l'URL est la source de vérité (SSR compris).
    if (i18n.resolvedLanguage !== lang) void i18n.changeLanguage(lang);
  },
  component: LangLayout,
});

function LangLayout() {
  const { lang } = Route.useParams();

  useEffect(() => {
    const code = normalizeLang(lang);
    if (!code) return;
    if (i18n.resolvedLanguage !== code) void i18n.changeLanguage(code);
    document.documentElement.lang = code;
  }, [lang]);

  return <Outlet />;
}
