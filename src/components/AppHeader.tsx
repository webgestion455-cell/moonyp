import { Link, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Menu, X, Globe, ArrowRight, Check, Info } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SUPPORTED_LANGUAGES } from "@/i18n";
import moonypLogo from "@/assets/moonyp-logo.png";

const NAV = [
  { to: "/", key: "nav.home" },
  { to: "/solutions", key: "nav.solutions" },
  { to: "/simulation", key: "nav.simulation" },
  { to: "/about", key: "nav.about" },
  { to: "/contact", key: "nav.contact" },
] as const;

export function AppHeader() {
  const { t, i18n } = useTranslation();
  const { location } = useRouterState();
  const [open, setOpen] = useState(false);

  // Ferme le menu à chaque navigation
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  const current = SUPPORTED_LANGUAGES.find((l) => l.code === i18n.resolvedLanguage) ?? SUPPORTED_LANGUAGES[0];

  return (
    <header className="fixed inset-x-0 top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-3 sm:px-6 lg:px-8">
        <Link to="/" className="flex min-w-0 items-center gap-2" aria-label="MOONYP">
          <img
            src={moonypLogo}
            alt="MOONYP"
            width={36}
            height={36}
            className="h-8 w-8 shrink-0 object-contain sm:h-9 sm:w-9"
          />
          <span className="font-serif text-base font-semibold tracking-tight sm:text-lg">MOONYP</span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label={t("nav.primary")}>
          {NAV.map((item) => {
            const active = item.to === "/" ? location.pathname === "/" : location.pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-colors duration-200 ${
                  active ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t(item.key)}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-9 gap-1.5 px-2 text-muted-foreground hover:text-foreground"
                aria-label={t("nav.language")}
              >
                <Globe className="h-4 w-4" aria-hidden />
                <span className="text-[11px] font-semibold uppercase tracking-wide">{current?.code}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 w-56 overflow-y-auto">
              {SUPPORTED_LANGUAGES.map((l) => (
                <DropdownMenuItem
                  key={l.code}
                  onClick={() => void i18n.changeLanguage(l.code)}
                  className="gap-2 text-sm"
                >
                  <span aria-hidden>{l.flag}</span>
                  <span className="flex-1">{l.label}</span>
                  {l.code === current?.code && <Check className="h-4 w-4 text-primary" aria-hidden />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <button
            type="button"
            className="flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
            aria-label={t("nav.menu")}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
            <span className="text-[9px] font-semibold uppercase tracking-[0.12em]">{t("nav.menu")}</span>
          </button>
        </div>
      </div>

      {open && (
        <div className="animate-in fade-in slide-in-from-top-2 border-t border-border bg-background duration-200 md:hidden">
          <nav className="mx-auto flex max-w-7xl flex-col gap-2 px-3 py-4" aria-label={t("nav.primary")}>
            <Link
              to="/about"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-xl border border-border px-4 py-3.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              <Info className="h-4 w-4 text-accent" aria-hidden />
              {t("nav.about")}
            </Link>
            <Button asChild className="h-12 rounded-xl text-sm font-semibold">
              <Link
                to="/apply"
                search={{ product: undefined, amount: undefined, months: undefined }}
                onClick={() => setOpen(false)}
              >
                {t("nav.apply")}
                <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden />
              </Link>
            </Button>
          </nav>
        </div>
      )}
    </header>
  );
}
