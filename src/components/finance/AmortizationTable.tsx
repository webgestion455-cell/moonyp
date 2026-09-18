import { Fragment, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Download, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { datedSchedule, formatDate, formatMoney, groupScheduleByYear } from "@/lib/loan-math";
import type { Quotation } from "@/lib/loan-math";
import { cn } from "@/lib/utils";

interface Props {
  quotation: Quotation;
  startDate?: Date;
  locale?: string;
}

/**
 * Bank-grade amortisation table. Yearly roll-up first (a 360-instalment
 * mortgage stays readable), each year expands to the individual instalments.
 * All figures come from the shared, server-verified quotation.
 */
export function AmortizationTable({ quotation, startDate, locale = "fr" }: Props) {
  const { t } = useTranslation();
  const [openYear, setOpenYear] = useState<number | null>(null);

  const rows = useMemo(
    () => datedSchedule(quotation.schedule, startDate ?? new Date()),
    [quotation.schedule, startDate],
  );
  const years = useMemo(() => groupScheduleByYear(rows), [rows]);
  const money = (n: number) => formatMoney(n, quotation.currency, locale);

  const exportCsv = () => {
    const header = [
      t("finance.schedule.number"),
      t("finance.schedule.dueDate"),
      t("finance.schedule.payment"),
      t("finance.schedule.principal"),
      t("finance.schedule.interest"),
      t("finance.schedule.insurance"),
      t("finance.schedule.balance"),
    ].join(";");
    const body = rows
      .map((r) =>
        [r.index, r.dueDate, r.payment, r.principal, r.interest, r.insurance, r.balance].join(";"),
      )
      .join("\n");
    const blob = new Blob([`\uFEFF${header}\n${body}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "moonyp-echeancier.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="overflow-hidden rounded-xl border border-border">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <Table2 className="h-4 w-4 text-muted-foreground" aria-hidden />
          <h3 className="text-sm font-semibold">{t("finance.schedule.title")}</h3>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={exportCsv}>
          <Download className="h-4 w-4" aria-hidden />
          {t("finance.schedule.export")}
        </Button>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="px-4 py-2.5 font-medium">
                {t("finance.schedule.period")}
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                {t("finance.schedule.payment")}
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                {t("finance.schedule.principal")}
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                {t("finance.schedule.interest")}
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                {t("finance.schedule.balance")}
              </th>
            </tr>
          </thead>
          <tbody>
            {years.map((y) => {
              const expanded = openYear === y.year;
              return (
                <Fragment key={`y-${y.year}`}>
                  <tr
                    className={cn(
                      "border-b border-border transition-colors hover:bg-muted/40",
                      expanded && "bg-muted/40",
                    )}
                  >
                    <th scope="row" className="px-4 py-2.5 text-left font-medium">
                      <button
                        type="button"
                        onClick={() => setOpenYear(expanded ? null : y.year)}
                        aria-expanded={expanded}
                        className="flex items-center gap-1.5"
                      >
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 text-muted-foreground transition-transform",
                            expanded && "rotate-180",
                          )}
                          aria-hidden
                        />
                        {y.year}
                        <span className="text-xs font-normal text-muted-foreground">
                          ({y.rows.length})
                        </span>
                      </button>
                    </th>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                      {money(y.payment)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{money(y.principal)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{money(y.interest)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{money(y.balance)}</td>
                  </tr>

                  {expanded &&
                    y.rows.map((r) => (
                      <tr
                        key={`r-${r.index}`}
                        className="border-b border-border/60 bg-background text-xs"
                      >
                        <td className="px-4 py-2 pl-10 text-muted-foreground">
                          <span className="tabular-nums">#{r.index}</span> ·{" "}
                          {formatDate(r.dueDate, locale)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{money(r.payment)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{money(r.principal)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{money(r.interest)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{money(r.balance)}</td>
                      </tr>
                    ))}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-muted/50 text-sm font-semibold">
              <th scope="row" className="px-4 py-3 text-left">
                {t("finance.schedule.total")}
              </th>
              <td className="px-4 py-3 text-right tabular-nums">{money(quotation.totalRepaid)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{money(quotation.amount)}</td>
              <td className="px-4 py-3 text-right tabular-nums">
                {money(quotation.totalInterest)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">—</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
