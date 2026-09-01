import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { clampToStep, formatMoney, quote } from "@/lib/loan-math";
import type { LoanProduct, Quotation } from "@/lib/loan-math";

interface SimulatorProps {
  products: LoanProduct[];
  value: { productId: string; amount: number; months: number; insurance: boolean };
  onChange: (next: { productId: string; amount: number; months: number; insurance: boolean }) => void;
  onQuote?: (q: Quotation) => void;
  compact?: boolean;
}

export function productLabel(p: LoanProduct, t: (k: string) => string): string {
  if (!p.i18n_key) return p.name;
  const translated = t(`${p.i18n_key}.name`);
  return translated === `${p.i18n_key}.name` ? p.name : translated;
}

export function productDescription(p: LoanProduct, t: (k: string) => string): string {
  if (!p.i18n_key) return p.description ?? "";
  const translated = t(`${p.i18n_key}.desc`);
  return translated === `${p.i18n_key}.desc` ? (p.description ?? "") : translated;
}

function monthPresets(p: LoanProduct): number[] {
  const out: number[] = [];
  for (const m of [12, 24, 36, 48, 60, 72, 84, 96, 120, 180, 240, 300]) {
    if (m >= p.min_months && m <= p.max_months) out.push(m);
  }
  return out.slice(0, 6);
}

interface NumberFieldProps {
  id: string;
  label: string;
  hint: string;
  suffix: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onCommit: (v: number) => void;
}

function NumberField({ id, label, hint, suffix, value, min, max, step, onCommit }: NumberFieldProps) {
  const [draft, setDraft] = useState<string>(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = (raw: string) => {
    const parsed = Number(raw.replace(/[^\d.,-]/g, "").replace(",", "."));
    const next = Number.isFinite(parsed) ? clampToStep(parsed, min, max, step) : value;
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };

  const nudge = (dir: 1 | -1) => {
    const next = clampToStep(value + dir * step, min, max, step);
    if (next !== value) onCommit(next);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id} className="text-sm font-medium">{label}</Label>
        <span className="text-xs text-muted-foreground tabular-nums">{hint}</span>
      </div>
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          onClick={() => nudge(-1)}
          disabled={value <= min}
          aria-label={`${label} −`}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border text-lg font-semibold text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40"
        >
          −
        </button>
        <div className="relative flex-1">
          <input
            id={id}
            type="text"
            inputMode="numeric"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit((e.target as HTMLInputElement).value);
              }
            }}
            className="h-12 w-full rounded-xl border border-input bg-background pl-3 pr-16 text-lg font-semibold tabular-nums outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-muted-foreground">
            {suffix}
          </span>
        </div>
        <button
          type="button"
          onClick={() => nudge(1)}
          disabled={value >= max}
          aria-label={`${label} +`}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border text-lg font-semibold text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40"
        >
          +
        </button>
      </div>
    </div>
  );
}

export function Simulator({ products, value, onChange, onQuote, compact = false }: SimulatorProps) {
  const { t, i18n } = useTranslation();
  const product = useMemo(
    () => products.find((p) => p.id === value.productId) ?? products[0],
    [products, value.productId],
  );

  const [showSchedule, setShowSchedule] = useState(false);

  const result = useMemo(() => {
    if (!product) return null;
    return quote(product, value.amount, value.months, value.insurance);
  }, [product, value.amount, value.months, value.insurance]);

  useEffect(() => {
    if (result && onQuote) onQuote(result);
  }, [result, onQuote]);

  if (!product || !result) return null;

  const locale = i18n.resolvedLanguage ?? "fr";
  const money = (n: number) => formatMoney(n, product.currency, locale);

  const setProduct = (id: string) => {
    const next = products.find((p) => p.id === id);
    if (!next) return;
    onChange({
      productId: id,
      amount: clampToStep(value.amount, next.min_amount, next.max_amount, next.amount_step),
      months: clampToStep(value.months, next.min_months, next.max_months, next.months_step),
      insurance: value.insurance,
    });
  };

  return (
    <div className={compact ? "space-y-6" : "grid gap-6 lg:grid-cols-[1.1fr_1fr]"}>
      <Card className="p-4 sm:p-6">
        <div className="space-y-6">
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("finance.sim.product")}
            </Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {products.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setProduct(p.id)}
                  aria-pressed={p.id === product.id}
                  className={`rounded-xl border p-3 text-left text-sm transition-colors min-h-11 ${
                    p.id === product.id
                      ? "border-primary bg-primary/5 text-foreground"
                      : "border-border hover:bg-muted/60 text-muted-foreground"
                  }`}
                >
                  <span className="block font-semibold text-foreground">{productLabel(p, t)}</span>
                  <span className="block text-xs">{p.annual_rate.toFixed(2)}% · {p.currency}</span>
                </button>
              ))}
            </div>
          </div>

          <NumberField
            id="sim-amount"
            label={t("finance.sim.amount")}
            hint={`${money(product.min_amount)} – ${money(product.max_amount)}`}
            suffix={product.currency}
            value={value.amount}
            min={product.min_amount}
            max={product.max_amount}
            step={product.amount_step}
            onCommit={(v) => onChange({ ...value, amount: v })}
          />

          <div className="space-y-3">
            <NumberField
              id="sim-months"
              label={t("finance.sim.duration")}
              hint={`${product.min_months} – ${product.max_months} ${t("finance.sim.months")}`}
              suffix={t("finance.sim.months")}
              value={value.months}
              min={product.min_months}
              max={product.max_months}
              step={product.months_step}
              onCommit={(v) => onChange({ ...value, months: v })}
            />
            <div className="flex flex-wrap gap-2">
              {monthPresets(product).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => onChange({ ...value, months: m })}
                  aria-pressed={m === value.months}
                  className={`min-h-9 rounded-full border px-3 text-xs font-medium tabular-nums transition-colors ${
                    m === value.months
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:bg-muted/60"
                  }`}
                >
                  {m} {t("finance.sim.months")}
                </button>
              ))}
            </div>
          </div>

          {product.insurance_monthly_rate > 0 && (
            <div className="flex items-center justify-between gap-4 rounded-xl border border-border p-3">
              <div className="min-w-0">
                <Label htmlFor="sim-insurance" className="text-sm font-medium">
                  {t("finance.sim.insurance")}
                </Label>
                <p className="text-xs text-muted-foreground">{t("finance.sim.insuranceHint")}</p>
              </div>
              <Switch
                id="sim-insurance"
                checked={value.insurance}
                onCheckedChange={(checked) => onChange({ ...value, insurance: checked })}
              />
            </div>
          )}
        </div>
      </Card>

      <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent p-4 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("finance.sim.monthly")}
        </p>
        <p className="mt-1 text-3xl font-bold tabular-nums sm:text-4xl">{money(result.totalMonthly)}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("finance.sim.rate")} {result.annualRate.toFixed(2)}% · {t("finance.sim.apr")} {result.apr.toFixed(2)}%
        </p>

        <dl className="mt-5 space-y-2 text-sm">
          {[
            [t("finance.sim.borrowed"), money(result.amount)],
            [t("finance.sim.interest"), money(result.totalInterest)],
            [t("finance.sim.fees"), money(result.fees)],
            ...(result.totalInsurance > 0 ? [[t("finance.sim.insuranceCost"), money(result.totalInsurance)]] : []),
            [t("finance.sim.totalCost"), money(result.totalCost)],
          ].map(([label, val]) => (
            <div key={label} className="flex items-center justify-between gap-3 border-b border-border/60 pb-2">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-medium tabular-nums">{val}</dd>
            </div>
          ))}
          <div className="flex items-center justify-between gap-3 pt-1">
            <dt className="font-semibold">{t("finance.sim.totalRepaid")}</dt>
            <dd className="text-lg font-bold tabular-nums">{money(result.totalRepaid)}</dd>
          </div>
        </dl>

        <button
          type="button"
          onClick={() => setShowSchedule((s) => !s)}
          className="mt-4 text-sm font-medium text-primary underline-offset-4 hover:underline"
          aria-expanded={showSchedule}
        >
          {showSchedule ? t("finance.sim.hideSchedule") : t("finance.sim.showSchedule")}
        </button>

        {showSchedule && (
          <div className="mt-3 max-h-64 overflow-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  <th className="p-2 text-left font-medium">#</th>
                  <th className="p-2 text-right font-medium">{t("finance.sim.capital")}</th>
                  <th className="p-2 text-right font-medium">{t("finance.sim.interestShort")}</th>
                  <th className="p-2 text-right font-medium">{t("finance.sim.balance")}</th>
                </tr>
              </thead>
              <tbody>
                {result.schedule.map((row) => (
                  <tr key={row.index} className="border-t border-border/60">
                    <td className="p-2 tabular-nums">{row.index}</td>
                    <td className="p-2 text-right tabular-nums">{money(row.principal)}</td>
                    <td className="p-2 text-right tabular-nums">{money(row.interest)}</td>
                    <td className="p-2 text-right tabular-nums">{money(row.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-4 rounded-lg bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
          {t("finance.sim.disclaimer")}
        </p>
      </Card>
    </div>
  );
}
