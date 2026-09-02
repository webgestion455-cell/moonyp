import { Link, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useLang } from "@/lib/use-lang";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Menu, X, ArrowRight, Info } from "lucide-react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import moonypLogo from "@/assets/moonyp-logo.png";

const NAV = [
  { to: "/$lang" as const, key: "nav.home" },
  { to: "/$lang/solutions" as const, key: "nav.solutions" },
  { to: "/$lang/simulation" as const, key: "nav.simulation" },
  { to: "/$lang/about" as const, key: "nav.about" },
  { to: "/$lang/contact" as const, key: "nav.contact" },
] as const;

export function AppHeader() {
  const { t } = useTranslation();
  const { location } = useRouterState();
  const lang = useLang();
  const [open, setOpen] = useState(false);

  // Ferme le menu à chaque navigation
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  return (
    <header className="fixed inset-x-0 top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-3 sm:px-6 lg:px-8">
        <Link to="/$lang" params={{ lang }} className="flex min-w-0 items-center gap-2" aria-label="MOONYP">
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
            const href = item.to.replace("/$lang", `/${lang}`);
            const active = href === `/${lang}` ? location.pathname === href : location.pathname.startsWith(href);
            return (
              <Link
                key={item.to}
                to={item.to}
                params={{ lang }}
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
          <LanguageSwitcher />

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
              to="/$lang/about" params={{ lang }}
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-xl border border-border px-4 py-3.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              <Info className="h-4 w-4 text-accent" aria-hidden />
              {t("nav.about")}
            </Link>
            <Button asChild className="h-12 rounded-xl text-sm font-semibold">
              <Link
                to="/$lang/apply" params={{ lang }}
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
