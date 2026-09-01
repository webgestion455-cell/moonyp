import { useTranslation } from "react-i18next";
import { Briefcase, Car, Check, Home, Landmark, Wallet } from "lucide-react";
import { formatMoney } from "@/lib/loan-math";
import type { LoanProduct } from "@/lib/loan-math";
import { productDescription, productLabel } from "@/components/finance/Simulator";
import { cn } from "@/lib/utils";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  wallet: Wallet,
  car: Car,
  home: Home,
  briefcase: Briefcase,
};

interface Props {
  products: LoanProduct[];
  value: string;
  onChange: (productId: string) => void;
  locale?: string;
}

/** Compact, scannable product cards — one tap to select, no scrolling wall. */
export function ProductPicker({ products, value, onChange, locale = "fr" }: Props) {
  const { t } = useTranslation();

  return (
    <div role="radiogroup" aria-label={t("finance.sim.product")} className="grid gap-3 sm:grid-cols-2">
      {products.map((p) => {
        const Icon = ICONS[p.icon ?? ""] ?? Landmark;
        const selected = p.id === value;
        const compact = (n: number) =>
          new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(n);

        return (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(p.id)}
            className={cn(
              "group relative flex w-full items-start gap-3 rounded-xl border p-3.5 text-left transition-all duration-200",
              "hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected
                ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary"
                : "border-border bg-card hover:border-ring/50",
            )}
          >
            <span
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors",
                selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
              )}
            >
              <Icon className="h-5 w-5" aria-hidden />
            </span>

            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold">{productLabel(p, t)}</span>
                {selected && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden />}
              </span>
              <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-muted-foreground">
                {productDescription(p, t)}
              </span>
              <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] tabular-nums text-muted-foreground">
                <span>
                  {compact(p.min_amount)} – {compact(p.max_amount)} {p.currency === "EUR" ? "€" : p.currency}
                </span>
                <span aria-hidden>·</span>
                <span>{p.min_months}–{p.max_months} {t("finance.sim.months")}</span>
                <span aria-hidden>·</span>
                <span className="font-medium text-foreground">
                  {t("finance.sim.rateFrom", { rate: p.annual_rate })}
                </span>
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export { formatMoney };
