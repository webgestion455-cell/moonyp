import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Check, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SUPPORTED_LANGUAGES } from "@/i18n";
import { normalizeLang } from "@/lib/lang-url";

/**
 * Sélecteur de langue : réécrit uniquement le préfixe de langue de l'URL
 * courante. La route, les paramètres (token de dossier inclus), la query et
 * le hash sont strictement conservés.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { i18n, t } = useTranslation();
  const { location } = useRouterState();
  const navigate = useNavigate();

  const current = SUPPORTED_LANGUAGES.find((l) => l.code === i18n.resolvedLanguage) ?? SUPPORTED_LANGUAGES[0];

  const switchLanguage = (code: string) => {
    const segments = location.pathname.split("/").filter(Boolean);
    if (segments.length && normalizeLang(segments[0])) segments[0] = code;
    else segments.unshift(code);
    const hash = location.hash ? `#${location.hash.replace(/^#/, "")}` : "";
    const href = `/${segments.join("/")}${location.searchStr ?? ""}${hash}`;
    void i18n.changeLanguage(code);
    void navigate({ href });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`h-9 gap-1.5 px-2 text-muted-foreground hover:text-foreground ${className ?? ""}`}
          aria-label={t("nav.language")}
        >
          <Globe className="h-4 w-4" aria-hidden />
          <span className="text-[11px] font-semibold uppercase tracking-wide">{current?.code}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-56 overflow-y-auto">
        {SUPPORTED_LANGUAGES.map((l) => (
          <DropdownMenuItem key={l.code} onClick={() => switchLanguage(l.code)} className="gap-2 text-sm">
            <span aria-hidden>{l.flag}</span>
            <span className="flex-1">{l.label}</span>
            {l.code === current?.code && <Check className="h-4 w-4 text-primary" aria-hidden />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
