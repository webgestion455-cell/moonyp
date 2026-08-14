import { Link, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Menu, X, Globe, ArrowRight } from "lucide-react";
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
  { to: "/contact", key: "nav.contact" },
] as const;

export function AppHeader() {
  const { t, i18n } = useTranslation();
  const { location } = useRouterState();
  const [open, setOpen] = useState(false);

  const current = SUPPORTED_LANGUAGES.find((l) => l.code === i18n.resolvedLanguage) ?? SUPPORTED_LANGUAGES[0];

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-3 sm:px-6 lg:px-8">
        <Link to="/" className="flex items-center gap-2 min-w-0" aria-label="MOONYP">
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
                className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
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
              <Button variant="ghost" size="sm" className="gap-1.5 px-2" aria-label={t("nav.language")}>
                <Globe className="h-4 w-4" />
                <span className="hidden text-xs font-semibold uppercase sm:inline">{current?.code}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
              {SUPPORTED_LANGUAGES.map((l) => (
                <DropdownMenuItem key={l.code} onClick={() => void i18n.changeLanguage(l.code)}>
                  {l.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <ThemeToggle />

          <Button asChild size="sm" className="hidden rounded-full shadow-glow sm:inline-flex">
            <Link to="/apply" search={{ product: undefined, amount: undefined, months: undefined }}>
              {t("nav.apply")}
              <ArrowRight className="ml-1.5 h-4 w-4" />
            </Link>
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label={t("nav.menu")}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {open && (
        <div className="border-t border-border bg-background md:hidden">
          <nav className="mx-auto flex max-w-7xl flex-col gap-1 px-3 py-3" aria-label={t("nav.primary")}>
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-3 text-sm font-medium text-foreground hover:bg-muted"
              >
                {t(item.key)}
              </Link>
            ))}
            <Button asChild className="mt-2 rounded-full">
              <Link to="/apply" search={{ product: undefined, amount: undefined, months: undefined }} onClick={() => setOpen(false)}>
                {t("nav.apply")}
              </Link>
            </Button>
          </nav>
        </div>
      )}
    </header>
  );
}
