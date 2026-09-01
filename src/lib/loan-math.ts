/**
 * Pure loan mathematics — shared by the public simulator (client) and by the
 * server functions that re-validate every quotation. No side effects, no I/O.
 */

export interface ProductPricing {
  annual_rate: number;
  insurance_monthly_rate: number;
  fee_fixed: number;
  fee_percent: number;
}

export interface ProductLimits {
  min_amount: number;
  max_amount: number;
  amount_step: number;
  min_months: number;
  max_months: number;
  months_step: number;
}

export interface LoanProduct extends ProductPricing, ProductLimits {
  id: string;
  slug: string;
  name: string;
  i18n_key: string | null;
  description: string | null;
  icon: string | null;
  currency: string;
  sort_order: number;
}

export interface ScheduleRow {
  index: number;
  principal: number;
  interest: number;
  insurance: number;
  payment: number;
  balance: number;
}

export interface Quotation {
  amount: number;
  months: number;
  annualRate: number;
  /** Capital repayment + interest, insurance excluded. */
  monthlyPayment: number;
  insuranceMonthly: number;
  /** What the customer actually pays every month. */
  totalMonthly: number;
  totalInterest: number;
  totalInsurance: number;
  fees: number;
  /** Interest + insurance + fees. */
  totalCost: number;
  totalRepaid: number;
  /** Annual percentage rate of charge (TAEG), fees and insurance included. */
  apr: number;
  currency: string;
  schedule: ScheduleRow[];
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function clampToStep(value: number, min: number, max: number, step: number): number {
  const bounded = Math.min(Math.max(value, min), max);
  if (step <= 0) return round2(bounded);
  return round2(Math.round((bounded - min) / step) * step + min);
}

/** Standard annuity payment for an amortising loan. */
export function annuityPayment(amount: number, annualRate: number, months: number): number {
  if (months <= 0) return 0;
  const monthlyRate = annualRate / 100 / 12;
  if (monthlyRate === 0) return amount / months;
  const factor = Math.pow(1 + monthlyRate, months);
  return (amount * monthlyRate * factor) / (factor - 1);
}

/**
 * Internal rate of return solved by bisection: the monthly rate that makes the
 * discounted cash flows equal the net amount actually received by the borrower.
 */
function solveApr(netReceived: number, monthlyFlow: number, months: number): number {
  if (netReceived <= 0 || monthlyFlow <= 0 || months <= 0) return 0;
  const npv = (monthlyRate: number) => {
    if (monthlyRate === 0) return monthlyFlow * months - netReceived;
    const factor = Math.pow(1 + monthlyRate, -months);
    return (monthlyFlow * (1 - factor)) / monthlyRate - netReceived;
  };
  let low = 0;
  let high = 1; // 100% monthly is far above any realistic rate
  if (npv(low) < 0) return 0;
  for (let i = 0; i < 200; i += 1) {
    const mid = (low + high) / 2;
    if (npv(mid) > 0) low = mid;
    else high = mid;
  }
  const monthly = (low + high) / 2;
  return round2((Math.pow(1 + monthly, 12) - 1) * 100);
}

export function quote(
  product: ProductPricing & { currency?: string },
  amount: number,
  months: number,
  withInsurance: boolean,
): Quotation {
  const annualRate = Number(product.annual_rate) || 0;
  const insuranceRate = withInsurance ? Number(product.insurance_monthly_rate) || 0 : 0;
  const fees = round2(Number(product.fee_fixed) + (amount * Number(product.fee_percent)) / 100);

  const monthlyPayment = round2(annuityPayment(amount, annualRate, months));
  const insuranceMonthly = round2((amount * insuranceRate) / 100);
  const totalMonthly = round2(monthlyPayment + insuranceMonthly);

  const schedule: ScheduleRow[] = [];
  const monthlyRate = annualRate / 100 / 12;
  let balance = amount;
  let totalInterest = 0;

  for (let i = 1; i <= months; i += 1) {
    const interest = round2(balance * monthlyRate);
    let principal = round2(monthlyPayment - interest);
    if (i === months) principal = round2(balance);
    balance = round2(Math.max(balance - principal, 0));
    totalInterest = round2(totalInterest + interest);
    schedule.push({
      index: i,
      principal,
      interest,
      insurance: insuranceMonthly,
      payment: round2(principal + interest + insuranceMonthly),
      balance,
    });
  }

  const totalInsurance = round2(insuranceMonthly * months);
  const totalCost = round2(totalInterest + totalInsurance + fees);

  return {
    amount: round2(amount),
    months,
    annualRate,
    monthlyPayment,
    insuranceMonthly,
    totalMonthly,
    totalInterest,
    totalInsurance,
    fees,
    totalCost,
    totalRepaid: round2(amount + totalCost),
    apr: solveApr(amount - fees, totalMonthly, months),
    currency: product.currency ?? "EUR",
    schedule,
  };
}

/** Debt-to-income indicator used by the internal pre-analysis. */
export function debtRatio(totalMonthly: number, income: number, charges: number): number | null {
  const netIncome = (income || 0) - (charges || 0);
  if (netIncome <= 0) return null;
  return Math.round(((totalMonthly / netIncome) * 100 + Number.EPSILON) * 10) / 10;
}

export function formatMoney(value: number, currency = "EUR", locale = "fr"): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

/* ------------------------------------------------------------------------ */
/* Amortisation schedule (bank grade)                                        */
/* ------------------------------------------------------------------------ */

export interface DatedScheduleRow extends ScheduleRow {
  /** ISO date (yyyy-mm-dd) of the instalment due date. */
  dueDate: string;
}

/**
 * First instalment falls one period after disbursement. Dates are computed on
 * the same anchor day, clamped to the end of shorter months.
 */
export function addMonths(start: Date, months: number): Date {
  const anchor = start.getUTCDate();
  const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(anchor, lastDay));
  return d;
}

/** Attaches real due dates to a quotation schedule. */
export function datedSchedule(
  schedule: ScheduleRow[],
  startDate: Date = new Date(),
  monthsPerPeriod = 1,
): DatedScheduleRow[] {
  return schedule.map((row) => ({
    ...row,
    dueDate: addMonths(startDate, row.index * monthsPerPeriod).toISOString().slice(0, 10),
  }));
}

export function formatDate(iso: string, locale = "fr"): string {
  try {
    return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric" }).format(
      new Date(`${iso}T00:00:00Z`),
    );
  } catch {
    return iso;
  }
}

/**
 * Yearly roll-up of a schedule — what banks print above the detailed table so
 * a 300-instalment mortgage stays readable.
 */
export interface ScheduleYear {
  year: number;
  payment: number;
  principal: number;
  interest: number;
  insurance: number;
  balance: number;
  rows: DatedScheduleRow[];
}

export function groupScheduleByYear(rows: DatedScheduleRow[]): ScheduleYear[] {
  const out: ScheduleYear[] = [];
  for (const row of rows) {
    const year = Number(row.dueDate.slice(0, 4));
    let bucket = out.find((b) => b.year === year);
    if (!bucket) {
      bucket = { year, payment: 0, principal: 0, interest: 0, insurance: 0, balance: row.balance, rows: [] };
      out.push(bucket);
    }
    bucket.payment += row.payment;
    bucket.principal += row.principal;
    bucket.interest += row.interest;
    bucket.insurance += row.insurance;
    bucket.balance = row.balance;
    bucket.rows.push(row);
  }
  return out.map((b) => ({
    ...b,
    payment: Math.round(b.payment * 100) / 100,
    principal: Math.round(b.principal * 100) / 100,
    interest: Math.round(b.interest * 100) / 100,
    insurance: Math.round(b.insurance * 100) / 100,
  }));
}
