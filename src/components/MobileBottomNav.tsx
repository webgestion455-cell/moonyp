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
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-1 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-1.5 backdrop-blur-xl md:hidden"
      aria-label={t("nav.primary")}
    >
      <div className="mx-auto grid w-full max-w-md grid-cols-5 gap-0.5">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const path = item.to.replace("/$lang", `/${lang}`);
          const active =
            location.pathname === path ||
            location.pathname.startsWith(`${path}/`);

          return (
            <Link
              key={item.to}
              to={item.to}
              params={{ lang }}
              search={{
                product: undefined,
                amount: undefined,
                months: undefined,
              } as never}
              aria-current={active ? "page" : undefined}
              className={`flex min-w-0 min-h-[52px] flex-col items-center justify-center rounded-lg px-0.5 py-1 text-center text-[10px] font-medium leading-tight transition-colors ${
                active
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon
                className={`mb-0.5 h-5 w-5 shrink-0 transition-transform ${
                  active ? "scale-110" : ""
                }`}
                aria-hidden
              />

              <span className="line-clamp-2 w-full break-words">
                {t(item.key)}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

