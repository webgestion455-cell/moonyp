import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  Info,
  Loader2,
  Lock,
  ShieldCheck,
} from "lucide-react";
import i18n from "@/i18n";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { AddressField, type AddressValue } from "@/components/finance/AddressField";
import { BirthDateField } from "@/components/finance/BirthDateField";
import { CountrySelect } from "@/components/finance/CountrySelect";
import { PhoneField, isValidPhone } from "@/components/finance/PhoneField";
import { ProductPicker } from "@/components/finance/ProductPicker";
import { AmortizationTable } from "@/components/finance/AmortizationTable";
import {
  EMPTY_KYC,
  KycFlow,
  docLabel,
  isKycComplete,
  resolveKycPlan,
  type KycDocumentType,
  type KycState,
} from "@/components/finance/KycFlow";
import { supabase } from "@/integrations/supabase/client";
import {
  createUploadUrl,
  listDocumentTypes,
  listProducts,
  registerDocuments,
  submitApplication,
} from "@/lib/applications.functions";
import {
  APPLY_DRAFT_KEY,
  APPLY_STEPS,
  EMPLOYMENT_STATUSES,
  consentSchema,
  employmentSchema,
  identitySchema,
  payoutSchema,
  requestSchema,
} from "@/lib/application-schema";
import { auditPayout, formatIban, normaliseIban, validateIban } from "@/lib/iban";
import { clampToStep, debtRatio, formatMoney, quote } from "@/lib/loan-math";
import type { LoanProduct } from "@/lib/loan-math";
import { countryName } from "@/lib/countries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/apply")({
  validateSearch: (search: Record<string, unknown>) => ({
    product: typeof search.product === "string" ? search.product.slice(0, 40) : undefined,
    amount: typeof search.amount === "number" ? search.amount : undefined,
    months: typeof search.months === "number" ? search.months : undefined,
  }),
  loader: async () => ({
    products: await listProducts(),
    documentTypes: await listDocumentTypes(),
  }),
  component: ApplyPage,
  head: () => ({
    meta: [
      { title: i18n.t("finance.apply.metaTitle") },
      { name: "description", content: i18n.t("finance.apply.metaDesc") },
      { property: "og:title", content: i18n.t("finance.apply.metaTitle") },
      { property: "og:description", content: i18n.t("finance.apply.metaDesc") },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

type FormState = Record<string, unknown>;

const EMPTY: FormState = {
  first_name: "", last_name: "", birth_date: "", nationality: "", address: "", postal_code: "",
  city: "", country: "", phone: "", phone_country: "", email: "",
  employment_status: "", profession: "", employer: "", seniority_months: "", monthly_income: "",
  monthly_charges: "", other_income: "0", household_size: "1",
  purpose: "",
  bank_holder: "", bank_name: "", bank_iban: "", bank_bic: "",
  consent_terms: false, consent_privacy: false, consent_marketing: false,
};

function ApplyPage() {
  const { products, documentTypes } = Route.useLoaderData() as {
    products: LoanProduct[];
    documentTypes: KycDocumentType[];
  };
  const search = Route.useSearch();
  const { t, i18n: i18next } = useTranslation();
  const navigate = useNavigate();

  const submitFn = useServerFn(submitApplication);
  const uploadUrlFn = useServerFn(createUploadUrl);
  const registerFn = useServerFn(registerDocuments);

  const initialProduct = products.find((p) => p.slug === search.product) ?? products[0];

  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [kyc, setKyc] = useState<KycState>(EMPTY_KYC);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ reference: string; token: string } | null>(null);
  const [loan, setLoan] = useState(() => ({
    productId: initialProduct?.id ?? "",
    amount: initialProduct
      ? clampToStep(search.amount ?? (initialProduct.min_amount + initialProduct.max_amount) / 4,
          initialProduct.min_amount, initialProduct.max_amount, initialProduct.amount_step)
      : 0,
    months: initialProduct
      ? clampToStep(search.months ?? Math.round((initialProduct.min_months + initialProduct.max_months) / 3),
          initialProduct.min_months, initialProduct.max_months, initialProduct.months_step)
      : 0,
    insurance: true,
  }));

  const topRef = useRef<HTMLDivElement>(null);
  const locale = i18next.resolvedLanguage ?? "fr";
  const product = products.find((p) => p.id === loan.productId) ?? initialProduct;

  /* --------------------------- Local draft ---------------------------- */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(APPLY_DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { form?: FormState; loan?: typeof loan; step?: number };
        if (parsed.form) setForm((f) => ({ ...f, ...parsed.form }));
        if (parsed.loan?.productId) setLoan((l) => ({ ...l, ...parsed.loan }));
        // Captured documents are never persisted; the applicant resumes at most on step 5.
        if (parsed.step && parsed.step >= 1 && parsed.step <= 5) setStep(parsed.step);
      }
    } catch {
      /* ignore corrupted draft */
    }
  }, []);

  useEffect(() => {
    if (result) return;
    try {
      localStorage.setItem(APPLY_DRAFT_KEY, JSON.stringify({ form, loan, step }));
    } catch {
      /* quota exceeded — progress simply is not persisted */
    }
  }, [form, loan, step, result]);

  const set = useCallback((key: string, value: unknown) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: "" } : e));
  }, []);

  /* ------------------------ Derived banking data ----------------------- */
  const quotation = useMemo(
    () => (product ? quote(product, loan.amount, loan.months, loan.insurance) : null),
    [product, loan.amount, loan.months, loan.insurance],
  );

  const dti = useMemo(() => {
    if (!quotation) return null;
    return debtRatio(
      quotation.totalMonthly,
      Number(form.monthly_income ?? 0) + Number(form.other_income ?? 0),
      Number(form.monthly_charges ?? 0),
    );
  }, [quotation, form.monthly_income, form.other_income, form.monthly_charges]);

  const ibanCheck = useMemo(() => validateIban(String(form.bank_iban ?? "")), [form.bank_iban]);
  const payoutAudit = useMemo(
    () =>
      auditPayout({
        bank_holder: String(form.bank_holder ?? ""),
        bank_iban: String(form.bank_iban ?? ""),
        bank_bic: String(form.bank_bic ?? ""),
        first_name: String(form.first_name ?? ""),
        last_name: String(form.last_name ?? ""),
        residence_country: String(form.country ?? ""),
      }),
    [form.bank_holder, form.bank_iban, form.bank_bic, form.first_name, form.last_name, form.country],
  );

  const kycPlan = useMemo(
    () =>
      resolveKycPlan(documentTypes, {
        employmentStatus: String(form.employment_status ?? ""),
        productSlug: product?.slug ?? "",
        allowedIdDocuments: [],
        countryCode: String(form.country ?? ""),
      }),
    [documentTypes, form.employment_status, product?.slug, form.country],
  );

  const employmentFields = useMemo(() => {
    switch (String(form.employment_status ?? "")) {
      case "employee":
      case "civil_servant":
      case "self_employed":
      case "business_owner":
        return { profession: true, employer: true, seniority: true };
      case "retired":
      case "unemployed":
      case "student":
        return { profession: false, employer: false, seniority: false };
      case "other":
        return { profession: true, employer: false, seniority: false };
      default:
        return { profession: false, employer: false, seniority: false };
    }
  }, [form.employment_status]);

  const setEmploymentStatus = (status: string) => {
    setForm((f) => ({
      ...f,
      employment_status: status,
      ...(["retired", "unemployed", "student"].includes(status)
        ? { profession: "", employer: "", seniority_months: "0" }
        : {}),
      ...(status === "other" ? { employer: "", seniority_months: "0" } : {}),
    }));
    setErrors((e) => ({ ...e, employment_status: "" }));
  };

  const goTo = (next: number) => {
    setStep(next);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  /* ------------------------------ Validation --------------------------- */
  function validateStep(current: number): boolean {
    if (current === 5) {
      if (!isKycComplete(kycPlan, kyc)) {
        toast.error(t("finance.apply.documentsMissing"));
        return false;
      }
      return true;
    }

    const schemas: Record<number, { safeParse: (v: unknown) => { success: boolean; error?: { issues: { path: (string | number)[]; message: string }[] } } }> = {
      1: identitySchema,
      2: employmentSchema,
      3: requestSchema,
      4: payoutSchema,
      6: consentSchema,
    };
    const schema = schemas[current];
    if (!schema) return true;

    const payload =
      current === 3
        ? { product_id: loan.productId, amount: loan.amount, duration_months: loan.months, purpose: form.purpose, insurance_opted: loan.insurance }
        : form;
    const parsed = schema.safeParse(payload);

    const next: Record<string, string> = {};
    for (const issue of parsed.error?.issues ?? []) {
      next[String(issue.path[0])] = t(issue.message) === issue.message ? t("finance.validation.required") : t(issue.message);
    }

    // Domain rules the generic schema cannot express.
    if (current === 1) {
      if (!String(form.nationality ?? "")) next.nationality = t("finance.validation.required");
      if (!isValidPhone(String(form.phone ?? ""), String(form.phone_country ?? ""))) {
        next.phone = t("validation.phone");
      }
    }
    if (current === 4) {
      for (const issue of payoutAudit.issues.filter((i) => i.severity === "error")) {
        next[issue.field] = t(`finance.validation.${issue.code}`, { defaultValue: t("finance.validation.required") });
      }
    }

    if (Object.values(next).filter(Boolean).length === 0) {
      setErrors({});
      return true;
    }
    setErrors(next);
    toast.error(t("finance.apply.fixErrors"));
    return false;
  }

  /* ------------------------------- Submit ------------------------------ */
  async function handleSubmit() {
    if (!validateStep(6)) return;
    setBusy(true);
    try {
      const payload = {
        ...form,
        bank_iban: normaliseIban(String(form.bank_iban ?? "")),
        product_id: loan.productId,
        amount: loan.amount,
        duration_months: loan.months,
        insurance_opted: loan.insurance,
        language: locale.split("-")[0],
      };
      const created = await submitFn({ data: payload as never });

      const captures = Object.entries(kyc.files).flatMap(([slug, list]) =>
        list.map((capture) => ({ slug, file: capture.file, evidence: capture.evidence })),
      );
      setProgress({ done: 0, total: captures.length });

      const registered: Array<{
        document_type_slug: string; storage_path: string; file_name: string; mime_type: string; file_size: number;
        capture_evidence?: unknown;
      }> = [];

      for (const [index, capture] of captures.entries()) {
        const { file, slug, evidence } = capture;
        const signed = await uploadUrlFn({
          data: { token: created.token, document_type_slug: slug, file_name: file.name, mime_type: file.type, file_size: file.size },
        });
        const { error } = await supabase.storage
          .from("kyc-documents")
          .uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type });
        if (error) throw new Error(error.message);
        registered.push({
          document_type_slug: slug, storage_path: signed.path, file_name: file.name,
          mime_type: file.type, file_size: file.size,
          // Preuve mesurée à la capture : revalidée côté serveur, jamais crue sur parole.
          ...(evidence ? { capture_evidence: evidence } : {}),
        });
        setProgress({ done: index + 1, total: captures.length });
      }

      if (registered.length > 0) {
        await registerFn({ data: { token: created.token, documents: registered } });
      }

      localStorage.removeItem(APPLY_DRAFT_KEY);
      setResult({ reference: created.reference, token: created.token });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      toast.error(
        message === "rate_limited"
          ? t("finance.apply.rateLimited")
          : message.startsWith("payout_invalid")
            ? t("finance.validation.iban.checksum")
            : t("finance.apply.submitError"),
      );
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  if (result) {
    return <SubmittedScreen reference={result.reference} token={result.token} />;
  }

  const field = (
    name: string,
    labelKey: string,
    extra?: { type?: string; placeholder?: string; inputMode?: "text" | "numeric" | "tel" | "email" | "decimal"; suffix?: string; hint?: string },
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={name} className="text-sm">{t(labelKey)}</Label>
      <div className="relative">
        <Input
          id={name}
          name={name}
          type={extra?.type ?? "text"}
          inputMode={extra?.inputMode}
          placeholder={extra?.placeholder}
          value={String(form[name] ?? "")}
          onChange={(e) => set(name, e.target.value)}
          aria-invalid={Boolean(errors[name])}
          aria-describedby={errors[name] ? `${name}-error` : undefined}
          className={cn("h-11", extra?.suffix && "pr-12")}
        />
        {extra?.suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
            {extra.suffix}
          </span>
        )}
      </div>
      {extra?.hint && !errors[name] && <p className="text-xs text-muted-foreground">{extra.hint}</p>}
      {errors[name] && (
        <p id={`${name}-error`} role="alert" className="text-xs font-medium text-destructive">{errors[name]}</p>
      )}
    </div>
  );

  const currency = product?.currency ?? "EUR";

  return (
    <div ref={topRef} className="mx-auto w-full max-w-4xl px-4 pb-32 pt-8 sm:px-6 sm:pt-12 lg:px-8">
      <header>
        <h1 className="font-serif text-2xl font-medium tracking-tight sm:text-3xl">{t("finance.apply.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("finance.apply.subtitle")}</p>
      </header>

      {/* Discreet progress indicator: one step at a time, no clutter. */}
      <div className="mt-6">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-medium">{t(APPLY_STEPS[step - 1]!.key)}</p>
          <p className="text-xs tabular-nums text-muted-foreground">
            {t("finance.apply.stepOf", { current: step, total: APPLY_STEPS.length })}
          </p>
        </div>
        <Progress value={(step / APPLY_STEPS.length) * 100} className="mt-2 h-1" />
      </div>

      <Card key={step} className="mt-5 animate-step p-4 sm:p-6">
        {/* 1 — Identity */}
        {step === 1 && (
          <section className="grid gap-4 sm:grid-cols-2">
            {field("first_name", "finance.fields.firstName")}
            {field("last_name", "finance.fields.lastName")}
            <BirthDateField
              value={String(form.birth_date ?? "")}
              error={errors.birth_date}
              label={t("finance.fields.birthDate")}
              onChange={(value) => set("birth_date", value)}
            />
            <CountrySelect
              id="nationality"
              label={t("finance.fields.nationality")}
              value={String(form.nationality ?? "")}
              onChange={(code) => set("nationality", code)}
              error={errors.nationality}
              required
            />
            <div className="sm:col-span-2">
              <AddressField
                value={{
                  address: String(form.address ?? ""),
                  postal_code: String(form.postal_code ?? ""),
                  city: String(form.city ?? ""),
                  country: String(form.country ?? ""),
                }}
                errors={{
                  address: errors.address,
                  postal_code: errors.postal_code,
                  city: errors.city,
                  country: errors.country,
                }}
                onChange={(patch: Partial<AddressValue>) => {
                  setForm((f) => ({ ...f, ...patch }));
                  setErrors((e) => {
                    const next = { ...e };
                    for (const k of Object.keys(patch)) next[k] = "";
                    return next;
                  });
                }}
              />
            </div>
            <PhoneField
              id="phone"
              label={t("finance.fields.phone")}
              value={String(form.phone ?? "")}
              country={String(form.phone_country ?? "")}
              hints={[String(form.country ?? ""), String(form.nationality ?? "")]}
              onChange={({ value, country }) => setForm((f) => ({ ...f, phone: value, phone_country: country }))}
              error={errors.phone}
              required
            />
            {field("email", "finance.fields.email", { type: "email", inputMode: "email" })}
          </section>
        )}

        {/* 2 — Professional situation */}
        {step === 2 && (
          <section className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="employment_status" className="text-sm">{t("finance.fields.employmentStatus")}</Label>
              <select
                id="employment_status"
                value={String(form.employment_status ?? "")}
                onChange={(e) => setEmploymentStatus(e.target.value)}
                className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                aria-invalid={Boolean(errors.employment_status)}
              >
                <option value="">{t("finance.fields.choose")}</option>
                {EMPLOYMENT_STATUSES.map((s) => (
                  <option key={s} value={s}>{t(`finance.employment.${s}`)}</option>
                ))}
              </select>
              {errors.employment_status && <p role="alert" className="text-xs font-medium text-destructive">{errors.employment_status}</p>}
            </div>
            {employmentFields.profession && field("profession", "finance.fields.profession")}
            {employmentFields.employer && field("employer", "finance.fields.employer")}
            {employmentFields.seniority && field("seniority_months", "finance.fields.seniority", { inputMode: "numeric", suffix: t("finance.sim.monthsShort") })}
            {field("household_size", "finance.fields.household", { inputMode: "numeric" })}
            {field("monthly_income", "finance.fields.income", { inputMode: "decimal", suffix: currency })}
            {field("monthly_charges", "finance.fields.charges", { inputMode: "decimal", suffix: currency })}
            {field("other_income", "finance.fields.otherIncome", { inputMode: "decimal", suffix: currency })}
          </section>
        )}

        {/* 3 — Product, amount, duration */}
        {step === 3 && product && (
          <section className="space-y-6">
            <ProductPicker
              products={products}
              value={loan.productId}
              locale={locale}
              onChange={(productId) => {
                const next = products.find((p) => p.id === productId);
                if (!next) return;
                setLoan((l) => ({
                  ...l,
                  productId,
                  amount: clampToStep(l.amount, next.min_amount, next.max_amount, next.amount_step),
                  months: clampToStep(l.months, next.min_months, next.max_months, next.months_step),
                }));
              }}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <AmountField
                id="amount"
                label={t("finance.sim.amount")}
                value={loan.amount}
                min={product.min_amount}
                max={product.max_amount}
                step={product.amount_step}
                suffix={currency}
                locale={locale}
                currency={currency}
                onChange={(amount) => setLoan((l) => ({ ...l, amount }))}
              />
              <AmountField
                id="months"
                label={t("finance.sim.duration")}
                value={loan.months}
                min={product.min_months}
                max={product.max_months}
                step={product.months_step}
                suffix={t("finance.sim.monthsShort")}
                integer
                locale={locale}
                currency={currency}
                onChange={(months) => setLoan((l) => ({ ...l, months }))}
              />
            </div>

            <label className="flex items-start gap-3 rounded-xl border border-border p-4 text-sm">
              <Checkbox
                checked={loan.insurance}
                onCheckedChange={(checked) => setLoan((l) => ({ ...l, insurance: checked === true }))}
                className="mt-0.5"
              />
              <span>
                <span className="block font-medium">{t("finance.sim.insurance")}</span>
                <span className="block text-xs text-muted-foreground">{t("finance.sim.insuranceHint")}</span>
              </span>
            </label>

            <div className="space-y-1.5">
              <Label htmlFor="purpose" className="text-sm">{t("finance.fields.purpose")}</Label>
              <Textarea
                id="purpose"
                value={String(form.purpose ?? "")}
                onChange={(e) => set("purpose", e.target.value)}
                rows={3}
                maxLength={500}
              />
            </div>

            {quotation && (
              <div className="space-y-4">
                <OfferSummary
                  monthly={quotation.totalMonthly}
                  apr={quotation.apr}
                  rate={quotation.annualRate}
                  totalCost={quotation.totalCost}
                  totalRepaid={quotation.totalRepaid}
                  fees={quotation.fees}
                  currency={currency}
                  locale={locale}
                  dti={dti}
                />
                <AmortizationTable quotation={quotation} locale={locale} />
              </div>
            )}
          </section>
        )}

        {/* 4 — Payout details */}
        {step === 4 && (
          <section className="space-y-4">
            <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {t("finance.apply.bankNotice")}
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              {field("bank_holder", "finance.fields.bankHolder", { hint: t("finance.apply.holderHint") })}
              {field("bank_name", "finance.fields.bankName")}
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="bank_iban" className="text-sm">{t("finance.fields.iban")}</Label>
                <Input
                  id="bank_iban"
                  value={formatIban(String(form.bank_iban ?? ""))}
                  onChange={(e) => set("bank_iban", normaliseIban(e.target.value).slice(0, 34))}
                  placeholder="FR76 3000 1007 9412 3456 7890 185"
                  aria-invalid={Boolean(errors.bank_iban)}
                  className="h-11 font-mono tracking-wider"
                  autoComplete="off"
                  spellCheck={false}
                />
                {String(form.bank_iban ?? "") !== "" && (
                  <p className={cn("flex items-center gap-1.5 text-xs font-medium", ibanCheck.valid ? "text-success" : "text-destructive")}>
                    {ibanCheck.valid ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : <AlertTriangle className="h-3.5 w-3.5" aria-hidden />}
                    {ibanCheck.valid
                      ? t("finance.validation.iban.valid", { country: countryName(ibanCheck.country, locale) })
                      : t(`finance.validation.iban.${ibanCheck.reason}`)}
                  </p>
                )}
                {errors.bank_iban && <p role="alert" className="text-xs font-medium text-destructive">{errors.bank_iban}</p>}
              </div>
              {field("bank_bic", "finance.fields.bic", { placeholder: "BNPAFRPPXXX" })}
            </div>

            {payoutAudit.issues.filter((i) => i.severity === "warning").length > 0 && (
              <div className="space-y-1.5 rounded-lg border border-warning/40 bg-warning/10 p-3">
                {payoutAudit.issues.filter((i) => i.severity === "warning").map((issue) => (
                  <p key={issue.code} className="flex items-start gap-2 text-xs leading-relaxed text-warning">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    {t(`finance.validation.${issue.code}`, { defaultValue: t("finance.apply.reviewFlag") })}
                  </p>
                ))}
              </div>
            )}
          </section>
        )}

        {/* 5 — KYC */}
        {step === 5 && product && (
          <KycFlow
            documentTypes={documentTypes}
            employmentStatus={String(form.employment_status ?? "")}
            productSlug={product.slug}
            allowedIdDocuments={[]}
            countryCode={String(form.country ?? "")}
            state={kyc}
            onChange={setKyc}
          />
        )}

        {/* 6 — Review */}
        {step === 6 && product && quotation && (
          <section className="space-y-5">
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">{t("finance.apply.reviewTitle")}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {formatMoney(quotation.totalMonthly, currency, locale)}
                <span className="ml-1 text-sm font-normal text-muted-foreground">{t("finance.sim.perMonth")}</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("finance.sim.aprLabel")} {quotation.apr.toFixed(2)}% · {loan.months} {t("finance.sim.months")}
              </p>
            </div>

            <ReviewBlock title={t("apply.steps.identity")} onEdit={() => goTo(1)} rows={[
              [t("finance.fields.firstName"), String(form.first_name ?? "")],
              [t("finance.fields.lastName"), String(form.last_name ?? "")],
              [t("finance.fields.birthDate"), String(form.birth_date ?? "")],
              [t("finance.fields.nationality"), countryName(String(form.nationality ?? ""), locale)],
              [t("finance.fields.address"), `${form.address ?? ""}, ${form.postal_code ?? ""} ${form.city ?? ""}, ${countryName(String(form.country ?? ""), locale)}`],
              [t("finance.fields.phone"), String(form.phone ?? "")],
              [t("finance.fields.email"), String(form.email ?? "")],
            ]} />
            <ReviewBlock title={t("apply.steps.employment")} onEdit={() => goTo(2)} rows={[
              [t("finance.fields.employmentStatus"), form.employment_status ? t(`finance.employment.${form.employment_status}`) : ""],
              ...(employmentFields.profession ? [[t("finance.fields.profession"), String(form.profession ?? "")]] : []),
              ...(employmentFields.employer ? [[t("finance.fields.employer"), String(form.employer ?? "")]] : []),
              [t("finance.fields.income"), formatMoney(Number(form.monthly_income ?? 0), currency, locale)],
              [t("finance.fields.charges"), formatMoney(Number(form.monthly_charges ?? 0), currency, locale)],
              [t("finance.apply.dti"), dti === null ? "—" : `${dti}%`],
            ]} />
            <ReviewBlock title={t("apply.steps.request")} onEdit={() => goTo(3)} rows={[
              [t("finance.sim.product"), product.i18n_key ? t(product.i18n_key, { defaultValue: product.name }) : product.name],
              [t("finance.sim.amount"), formatMoney(loan.amount, currency, locale)],
              [t("finance.sim.duration"), `${loan.months} ${t("finance.sim.months")}`],
              [t("finance.sim.insurance"), loan.insurance ? t("common.yes") : t("common.no")],
              [t("finance.sim.totalCost"), formatMoney(quotation.totalCost, currency, locale)],
            ]} />
            <ReviewBlock title={t("apply.steps.payout")} onEdit={() => goTo(4)} rows={[
              [t("finance.fields.bankHolder"), String(form.bank_holder ?? "")],
              [t("finance.fields.iban"), formatIban(String(form.bank_iban ?? ""))],
              [t("finance.fields.bic"), String(form.bank_bic ?? "") || "—"],
            ]} />
            <ReviewBlock
              title={t("apply.steps.documents")}
              onEdit={() => goTo(5)}
              rows={Object.entries(kyc.files).map(([slug, list]) => {
                const doc = documentTypes.find((d) => d.slug === slug);
                return [doc ? docLabel(doc, t) : slug, `${list.length} ${t("finance.apply.fileCount")}`];
              })}
            />

            <div className="space-y-3 rounded-xl border border-border p-4">
              {[
                ["consent_terms", "finance.apply.consentTerms"],
                ["consent_privacy", "finance.apply.consentPrivacy"],
                ["consent_marketing", "finance.apply.consentMarketing"],
              ].map(([key, labelKey]) => (
                <label key={key} className="flex items-start gap-3 text-sm leading-relaxed">
                  <Checkbox
                    checked={Boolean(form[key!])}
                    onCheckedChange={(checked) => set(key!, checked === true)}
                    aria-invalid={Boolean(errors[key!])}
                    className="mt-0.5"
                  />
                  <span className={errors[key!] ? "text-destructive" : "text-muted-foreground"}>{t(labelKey!)}</span>
                </label>
              ))}
            </div>

            <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {t("finance.apply.finalNotice")}
            </p>
          </section>
        )}
      </Card>

      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <Button
          variant="outline"
          size="lg"
          className="w-full sm:w-auto"
          onClick={() => (step === 1 ? navigate({ to: "/simulation", search: { product: undefined } }) : goTo(step - 1))}
          disabled={busy}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {step === 1 ? t("common.back") : t("finance.apply.previous")}
        </Button>
        {step < 6 ? (
          <Button size="lg" className="w-full sm:w-auto" onClick={() => validateStep(step) && goTo(step + 1)}>
            {t("finance.apply.next")}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
        ) : (
          <Button size="lg" className="w-full sm:w-auto" onClick={handleSubmit} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {progress && progress.total > 0
              ? t("finance.apply.uploading", { done: progress.done, total: progress.total })
              : t("finance.apply.submit")}
          </Button>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function AmountField({
  id, label, value, min, max, step, suffix, onChange, integer, locale, currency,
}: {
  id: string; label: string; value: number; min: number; max: number; step: number;
  suffix: string; onChange: (v: number) => void; integer?: boolean; locale: string; currency: string;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const presets = useMemo(() => {
    const raw = [0.1, 0.25, 0.5, 0.75].map((r) => clampToStep(min + (max - min) * r, min, max, step));
    return Array.from(new Set(raw));
  }, [min, max, step]);

  const commit = (raw: string) => {
    const parsed = Number(raw.replace(/[^\d.]/g, ""));
    if (!Number.isFinite(parsed)) { setDraft(String(value)); return; }
    onChange(clampToStep(parsed, min, max, step));
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm">{label}</Label>
      <div className="relative">
        <Input
          id={id}
          inputMode={integer ? "numeric" : "decimal"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") commit((e.target as HTMLInputElement).value); }}
          className="h-12 pr-16 text-lg font-semibold tabular-nums"
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-muted-foreground">
          {suffix}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs tabular-nums transition-colors",
              p === value ? "border-primary bg-primary/10 font-medium text-primary" : "border-border text-muted-foreground hover:border-ring/50",
            )}
          >
            {integer ? p : formatMoney(p, currency, locale)}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {t("finance.sim.range", {
          min: integer ? min : formatMoney(min, currency, locale),
          max: integer ? max : formatMoney(max, currency, locale),
        })}
      </p>
    </div>
  );
}

function OfferSummary({
  monthly, apr, rate, totalCost, totalRepaid, fees, currency, locale, dti,
}: {
  monthly: number; apr: number; rate: number; totalCost: number; totalRepaid: number;
  fees: number; currency: string; locale: string; dti: number | null;
}) {
  const { t } = useTranslation();
  const rows: Array<[string, string]> = [
    [t("finance.sim.rate"), `${rate.toFixed(2)}%`],
    [t("finance.sim.aprLabel"), `${apr.toFixed(2)}%`],
    [t("finance.sim.fees"), formatMoney(fees, currency, locale)],
    [t("finance.sim.totalCost"), formatMoney(totalCost, currency, locale)],
    [t("finance.sim.totalRepaid"), formatMoney(totalRepaid, currency, locale)],
  ];
  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">{t("finance.sim.instalment")}</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums">
            {formatMoney(monthly, currency, locale)}
            <span className="ml-1 text-sm font-normal text-muted-foreground">{t("finance.sim.perMonth")}</span>
          </p>
        </div>
        {dti !== null && (
          <span className={cn(
            "rounded-full px-3 py-1 text-xs font-medium",
            dti > 40 ? "bg-destructive/10 text-destructive" : dti > 33 ? "bg-warning/15 text-warning" : "bg-success/15 text-success",
          )}>
            {t("finance.apply.dti")} {dti}%
          </span>
        )}
      </div>
      <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-2 border-b border-border/60 pb-1.5">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
        <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        {t("finance.sim.legalNotice")}
      </p>
    </div>
  );
}

function ReviewBlock({ title, rows, onEdit }: { title: string; rows: string[][]; onEdit: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <button type="button" onClick={onEdit} className="text-xs font-medium text-primary underline-offset-4 hover:underline">
          {t("common.edit")}
        </button>
      </div>
      <dl className="mt-3 space-y-1.5 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-wrap justify-between gap-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="max-w-[60%] break-words text-right font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function SubmittedScreen({ reference, token }: { reference: string; token: string }) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6 sm:py-24">
      <Card className="p-6 text-center sm:p-10">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/15">
          <CheckCircle2 className="h-8 w-8 text-success" aria-hidden />
        </div>
        <h1 className="mt-6 font-serif text-2xl font-medium sm:text-3xl">{t("finance.success.title")}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t("finance.success.subtitle")}</p>

        <div className="mt-6 rounded-xl border border-border bg-muted/40 p-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">{t("finance.success.reference")}</p>
          <p className="mt-1 font-mono text-xl font-bold tracking-wider">{reference}</p>
        </div>

        <ul className="mt-6 space-y-2 text-left text-sm text-muted-foreground">
          <li className="flex gap-2"><span aria-hidden>•</span>{t("finance.success.step1")}</li>
          <li className="flex gap-2"><span aria-hidden>•</span>{t("finance.success.step2")}</li>
          <li className="flex gap-2"><span aria-hidden>•</span>{t("finance.success.step3")}</li>
        </ul>

        <Button asChild size="lg" className="mt-8 w-full">
          <Link to="/secure/application/$token" params={{ token }}>{t("finance.success.openFile")}</Link>
        </Button>
        <p className="mt-3 text-xs text-muted-foreground">{t("finance.success.linkNotice")}</p>
      </Card>
    </div>
  );
}
