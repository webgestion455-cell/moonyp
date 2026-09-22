import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useLang } from "@/lib/use-lang";
import { ArrowRight, Briefcase, Car, Home, Wallet, ShieldCheck } from "lucide-react";
import i18n from "@/i18n";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { listProducts } from "@/lib/applications.functions";
import { formatMoney } from "@/lib/loan-math";
import type { LoanProduct } from "@/lib/loan-math";
import { productDescription, productLabel } from "@/components/finance/Simulator";

export const Route = createFileRoute("/$lang/solutions")({
  loader: () => listProducts(),
  component: SolutionsPage,
  head: () => ({
    meta: [
      { title: i18n.t("finance.solutions.metaTitle") },
      { name: "description", content: i18n.t("finance.solutions.metaDesc") },
      { property: "og:title", content: i18n.t("finance.solutions.metaTitle") },
      { property: "og:description", content: i18n.t("finance.solutions.metaDesc") },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  errorComponent: () => <SolutionsError />,
});

const ICONS: Record<string, typeof Wallet> = {
  wallet: Wallet,
  car: Car,
  home: Home,
  briefcase: Briefcase,
};

function SolutionsError() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto w-full max-w-2xl px-3 py-20 text-center sm:px-4 sm:py-24">
      <h1 className="break-words text-2xl font-bold">
        {t("finance.solutions.title")}
      </h1>

      <p className="mt-2 break-words text-sm leading-relaxed text-muted-foreground">
        {t("common.errorRetry")}
      </p>
    </div>
  );
}

function SolutionsPage() {
  const products = Route.useLoaderData() as LoanProduct[];
  const { t, i18n: i18next } = useTranslation();
  const lang = useLang();
  const locale = i18next.resolvedLanguage ?? "en";

  return (
    <div className="mx-auto w-full max-w-6xl min-w-0 px-3 pb-28 pt-8 sm:px-6 sm:pb-24 sm:pt-12 lg:px-8 lg:pt-14">
      <header className="max-w-2xl">
        <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-muted/50 px-3 py-1 text-xs font-medium text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 break-words">
            {t("finance.solutions.badge")}
          </span>
        </span>

        <h1 className="mt-4 break-words font-serif text-3xl font-medium leading-tight tracking-tight sm:text-4xl">
          {t("finance.solutions.title")}
        </h1>

        <p className="mt-3 max-w-2xl break-words text-sm leading-relaxed text-muted-foreground sm:text-base">
          {t("finance.solutions.subtitle")}
        </p>
      </header>

      <div className="mt-8 grid min-w-0 gap-4 sm:mt-10 sm:grid-cols-2 xl:grid-cols-4">
        {products.map((product) => {
          const Icon = ICONS[product.icon ?? ""] ?? Wallet;

          return (
            <Card
              key={product.id}
              className="flex min-w-0 flex-col p-4 sm:p-5"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon className="h-5 w-5" aria-hidden />
              </div>

              <h2 className="mt-4 break-words text-lg font-semibold">
                {productLabel(product, t)}
              </h2>

              <p className="mt-2 min-w-0 flex-1 break-words text-sm leading-relaxed text-muted-foreground">
                {productDescription(product, t)}
              </p>

              <dl className="mt-4 space-y-2 text-xs">
                <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                  <dt className="break-words text-muted-foreground">
                    {t("finance.solutions.amountRange")}
                  </dt>

                  <dd className="break-words font-medium tabular-nums sm:text-right">
                    {formatMoney(product.min_amount, product.currency, locale)} –{" "}
                    {formatMoney(product.max_amount, product.currency, locale)}
                  </dd>
                </div>

                <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                  <dt className="break-words text-muted-foreground">
                    {t("finance.solutions.durationRange")}
                  </dt>

                  <dd className="break-words font-medium tabular-nums sm:text-right">
                    {product.min_months}–{product.max_months}{" "}
                    {t("finance.sim.months")}
                  </dd>
                </div>

                <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                  <dt className="break-words text-muted-foreground">
                    {t("finance.solutions.rateFrom")}
                  </dt>

                  <dd className="break-words font-medium tabular-nums sm:text-right">
                    {product.annual_rate.toFixed(2)}%
                  </dd>
                </div>
              </dl>

              <Button asChild className="mt-5 w-full">
                <Link
                  to="/$lang/simulation"
                  params={{ lang }}
                  search={{ product: product.slug }}
                >
                  <span className="min-w-0 break-words">
                    {t("finance.solutions.simulate")}
                  </span>

                  <ArrowRight
                    className="h-4 w-4 shrink-0"
                    aria-hidden
                  />
                </Link>
              </Button>
            </Card>
          );
        })}
      </div>

      <p className="mt-6 break-words rounded-xl border border-border bg-muted/40 p-4 text-xs leading-relaxed text-muted-foreground sm:mt-8">
        {t("finance.sim.disclaimer")}
      </p>
    </div>
  );
}