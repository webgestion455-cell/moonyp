import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Calculator } from "lucide-react";
import i18n from "@/i18n";
import { Button } from "@/components/ui/button";
import { Simulator } from "@/components/finance/Simulator";
import { listProducts } from "@/lib/applications.functions";
import type { LoanProduct } from "@/lib/loan-math";
import { clampToStep } from "@/lib/loan-math";

export const Route = createFileRoute("/simulation")({
  validateSearch: (search: Record<string, unknown>) => ({
    product: typeof search.product === "string" ? search.product.slice(0, 40) : undefined,
  }),
  loader: () => listProducts(),
  component: SimulationPage,
  head: () => ({
    meta: [
      { title: i18n.t("finance.simPage.metaTitle") },
      { name: "description", content: i18n.t("finance.simPage.metaDesc") },
      { property: "og:title", content: i18n.t("finance.simPage.metaTitle") },
      { property: "og:description", content: i18n.t("finance.simPage.metaDesc") },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function SimulationPage() {
  const products = Route.useLoaderData() as LoanProduct[];
  const { product: slug } = Route.useSearch();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const initial = products.find((p) => p.slug === slug) ?? products[0];
  const [value, setValue] = useState(() => ({
    productId: initial?.id ?? "",
    amount: initial ? clampToStep((initial.min_amount + initial.max_amount) / 4, initial.min_amount, initial.max_amount, initial.amount_step) : 0,
    months: initial ? clampToStep(Math.round((initial.min_months + initial.max_months) / 3), initial.min_months, initial.max_months, initial.months_step) : 0,
    insurance: true,
  }));

  if (!initial) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24 text-center">
        <p className="text-sm text-muted-foreground">{t("finance.simPage.noProducts")}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-28 pt-10 sm:px-6 sm:pt-14 lg:px-8">
      <header className="max-w-2xl">
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/50 px-3 py-1 text-xs font-medium text-muted-foreground">
          <Calculator className="h-3.5 w-3.5" aria-hidden />
          {t("finance.simPage.badge")}
        </span>
        <h1 className="mt-4 font-serif text-3xl font-medium tracking-tight sm:text-4xl">
          {t("finance.simPage.title")}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
          {t("finance.simPage.subtitle")}
        </p>
      </header>

      <div className="mt-8">
        <Simulator products={products} value={value} onChange={setValue} />
      </div>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Button
          size="lg"
          className="w-full sm:w-auto"
          onClick={() =>
            navigate({
              to: "/apply",
              search: { product: products.find((p) => p.id === value.productId)?.slug, amount: value.amount, months: value.months },
            })
          }
        >
          {t("finance.simPage.cta")}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Button>
        <Button asChild variant="outline" size="lg" className="w-full sm:w-auto">
          <Link to="/solutions">{t("finance.simPage.seeProducts")}</Link>
        </Button>
      </div>
    </div>
  );
}
