import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useLang } from "@/lib/use-lang";
import { Mail, MapPin, Phone, ShieldCheck } from "lucide-react";
import moonypLogo from "@/assets/moonyp-logo.png";

const LEGAL_LINKS = [
  { to: "/$lang/legal/privacy", key: "footer.privacy" },
  { to: "/$lang/legal/terms", key: "footer.terms" },
  { to: "/$lang/legal/cookies", key: "footer.cookies" },
  { to: "/$lang/legal/mentions", key: "footer.mentions" },
] as const;

const BANKING_LINKS = [
  { to: "/$lang/legal/loan-terms", key: "footer.loanTerms" },
  { to: "/$lang/legal/repayment", key: "footer.repayment" },
  { to: "/$lang/legal/aml-kyc", key: "footer.aml" },
  { to: "/$lang/legal/financial-privacy", key: "footer.finPriv" },
] as const;

export function SiteFooter() {
  const { t } = useTranslation();
  const lang = useLang();
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-card">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
        {/* Brand */}
        <div className="flex flex-col gap-4 border-b border-border pb-8 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <img
              src={moonypLogo}
              alt="MOONYP"
              width={40}
              height={40}
              className="h-9 w-9 shrink-0 object-contain"
            />
            <div>
              <p className="font-serif text-lg font-semibold tracking-tight text-foreground">
                MOONYP
              </p>
              <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground sm:text-sm">
                {t("footer.tagline")}
              </p>
            </div>
          </div>
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-success" aria-hidden />
            {t("footer.regulated")}
          </span>
        </div>

        {/* Three columns — side by side on every device */}
        <nav
          aria-label={t("footer.legal")}
          className="grid grid-cols-3 gap-x-3 gap-y-6 py-8 sm:gap-x-8 lg:gap-x-12"
        >
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground sm:text-xs">
              {t("footer.legal")}
            </p>
            <ul className="mt-3 space-y-2 text-[12px] text-muted-foreground sm:mt-4 sm:space-y-2.5 sm:text-sm">
              {LEGAL_LINKS.map((l) => (
                <li key={l.to}>
                  <Link
                    to={l.to}
                    params={{ lang }}
                    className="block break-words transition-colors hover:text-accent"
                  >
                    {t(l.key)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground sm:text-xs">
              {t("footer.banking")}
            </p>
            <ul className="mt-3 space-y-2 text-[12px] text-muted-foreground sm:mt-4 sm:space-y-2.5 sm:text-sm">
              {BANKING_LINKS.map((l) => (
                <li key={l.to}>
                  <Link
                    to={l.to}
                    params={{ lang }}
                    className="block break-words transition-colors hover:text-accent"
                  >
                    {t(l.key)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground sm:text-xs">
              {t("footer.contact")}
            </p>
            <ul className="mt-3 space-y-2 text-[12px] text-muted-foreground sm:mt-4 sm:space-y-2.5 sm:text-sm">
              <li>
                <Link
                  to="/$lang/contact"
                  params={{ lang }}
                  className="block break-words transition-colors hover:text-accent"
                >
                  {t("footer.contactForm")}
                </Link>
              </li>
              <li>
                <a
                  href="mailto:support@moonyp.com"
                  className="flex items-start gap-1.5 break-all transition-colors hover:text-accent"
                >
                  <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
                  support@moonyp.com
                </a>
              </li>
              <li>
                <a
                  href="tel:+393500366867"
                  className="flex items-start gap-1.5 transition-colors hover:text-accent"
                >
                  <Phone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
                  +39 350 036 6867
                </a>
              </li>
              <li className="flex items-start gap-1.5">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
                <span>1 Centenary Square, Birmingham, B1 2DR</span>
              </li>
            </ul>
          </div>
        </nav>

        <div className="border-t border-border pt-6 text-[11px] leading-relaxed text-muted-foreground sm:text-xs">
          <p>{t("footer.disclaimer")}</p>
          <p className="mt-3">
            © {year} MOONYP. {t("footer.rights")}
          </p>
        </div>
      </div>
    </footer>
  );
}
