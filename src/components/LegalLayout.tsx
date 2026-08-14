import { Link } from "@tanstack/react-router";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { ReactNode } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  title: string;
  subtitle?: string;
  updated?: string;
  children: ReactNode;
}

export function LegalLayout({ title, subtitle, updated, children }: Props) {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <Link to="/" className="inline-flex items-center gap-2 text-sm font-semibold text-foreground hover:text-accent">
            <ArrowLeft className="h-4 w-4" /> BNP PARIBAS
          </Link>
          <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-emerald-600" /> {t("legal.badge")}
          </span>
        </div>
      </header>
      <main className="container mx-auto max-w-3xl px-4 py-12">
        <h1 className="font-serif text-3xl font-medium text-foreground md:text-4xl">{title}</h1>
        {subtitle && <p className="mt-3 text-muted-foreground">{subtitle}</p>}
        {updated && <p className="mt-2 text-xs text-muted-foreground">{t("legal.lastUpdated")}: {updated}</p>}
        <div className="prose prose-sm mt-8 max-w-none text-foreground/90 prose-headings:font-serif prose-headings:text-foreground prose-a:text-accent">
          {children}
        </div>
        <div className="mt-12 border-t border-border pt-6 text-sm text-muted-foreground">
          <Link to="/" className="hover:text-accent">← {t("legal.home")}</Link>
        </div>
      </main>
    </div>
  );
}
