import { Link, useRouterState } from "@tanstack/react-router";
import { Calculator, FilePlus2, Home, LifeBuoy, Layers } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLang } from "@/lib/use-lang";

const ITEMS = [
  { to: "/$lang/home", key: "nav.home", icon: Home },
  { to: "/$lang/solutions", key: "nav.solutions", icon: Layers },
  { to: "/$lang/simulation", key: "nav.simulation", icon: Calculator },
  { to: "/$lang/apply", key: "nav.apply", icon: FilePlus2 },
  { to: "/$lang/contact", key: "nav.contact", icon: LifeBuoy },
] as const;

export function MobileBottomNav() {
  const { location } = useRouterState();
  const { t } = useTranslation();
  const lang = useLang();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 backdrop-blur-xl md:hidden"
      aria-label={t("nav.primary")}
    >
      <div className="mx-auto grid max-w-md grid-cols-5 gap-1">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const path = item.to.replace("/$lang", `/${lang}`);
          const active = location.pathname === path || location.pathname.startsWith(`${path}/`);
          return (
            <Link
              key={item.to}
              to={item.to}
              params={{ lang }}
              search={{ product: undefined, amount: undefined, months: undefined } as never}
              aria-current={active ? "page" : undefined}

              className={`flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-[10.5px] font-medium transition-colors ${
                active ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className={`h-5 w-5 transition-transform ${active ? "scale-110" : ""}`} aria-hidden />
              <span className="truncate">{t(item.key)}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
