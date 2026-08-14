import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  CheckCircle2,
  FileText,
  Loader2,
  Lock,
  Paperclip,
  Trash2,
} from "lucide-react";
import i18n from "@/i18n";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Simulator, productLabel } from "@/components/finance/Simulator";
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
import { clampToStep, formatMoney } from "@/lib/loan-math";
import type { LoanProduct } from "@/lib/loan-math";

interface DocumentType {
  slug: string;
  i18n_key: string | null;
  label: string;
  required: boolean;
  accepts_multiple: boolean;
  max_size_mb: number;
  allowed_mime: string[];
  sort_order: number;
}

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
  city: "", country: "", phone: "", email: "",
  employment_status: "", profession: "", employer: "", seniority_months: "", monthly_income: "",
  monthly_charges: "", other_income: "", household_size: "1",
  purpose: "",
  bank_holder: "", bank_name: "", bank_iban: "", bank_bic: "",
  consent_terms: false, consent_privacy: false, consent_marketing: false,
};

function docLabel(d: DocumentType, t: (k: string) => string): string {
  if (!d.i18n_key) return d.label;
  const translated = t(d.i18n_key);
  return translated === d.i18n_key ? d.label : translated;
}

function ApplyPage() {
  const { products, documentTypes } = Route.useLoaderData() as {
    products: LoanProduct[];
    documentTypes: DocumentType[];
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
  const [files, setFiles] = useState<Record<string, File[]>>({});
  const [busy, setBusy] = useState(false);
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

  // Progress is kept locally so the applicant can leave and come back.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(APPLY_DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { form?: FormState; loan?: typeof loan; step?: number };
        if (parsed.form) setForm((f) => ({ ...f, ...parsed.form }));
        if (parsed.loan?.productId) setLoan((l) => ({ ...l, ...parsed.loan }));
        if (parsed.step && parsed.step >= 1 && parsed.step <= 6) setStep(parsed.step);
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

  const goTo = (next: number) => {
    setStep(next);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  function validateStep(current: number): boolean {
    const schemas: Record<number, { safeParse: (v: unknown) => { success: boolean; error?: { issues: { path: (string | number)[]; message: string }[] } } }> = {
      1: identitySchema,
      2: employmentSchema,
      3: requestSchema,
      4: payoutSchema,
      6: consentSchema,
    };
    const schema = schemas[current];
    if (!schema) {
      if (current === 5) {
        const missing = documentTypes.filter((d) => d.required && !(files[d.slug]?.length));
        if (missing.length > 0) {
          toast.error(t("finance.apply.documentsMissing"));
          return false;
        }
      }
      return true;
    }
    const payload =
      current === 3
        ? { product_id: loan.productId, amount: loan.amount, duration_months: loan.months, purpose: form.purpose, insurance_opted: loan.insurance }
        : form;
    const parsed = schema.safeParse(payload);
    if (parsed.success) {
      setErrors({});
      return true;
    }
    const next: Record<string, string> = {};
    for (const issue of parsed.error?.issues ?? []) {
      next[String(issue.path[0])] = t(issue.message) === issue.message ? t("finance.validation.required") : t(issue.message);
    }
    setErrors(next);
    toast.error(t("finance.apply.fixErrors"));
    return false;
  }

  async function handleSubmit() {
    if (!validateStep(6)) return;
    setBusy(true);
    try {
      const payload = {
        ...form,
        product_id: loan.productId,
        amount: loan.amount,
        duration_months: loan.months,
        insurance_opted: loan.insurance,
        language: locale.split("-")[0],
      };
      const created = await submitFn({ data: payload as never });

      // Documents are pushed straight into the private bucket via one-shot URLs.
      const registered: Array<{
        document_type_slug: string; storage_path: string; file_name: string; mime_type: string; file_size: number;
      }> = [];
      for (const [slug, list] of Object.entries(files)) {
        for (const file of list) {
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
          });
        }
      }
      if (registered.length > 0) {
        await registerFn({ data: { token: created.token, documents: registered } });
      }

      localStorage.removeItem(APPLY_DRAFT_KEY);
      setResult({ reference: created.reference, token: created.token });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      toast.error(message === "rate_limited" ? t("finance.apply.rateLimited") : t("finance.apply.submitError"));
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return <SubmittedScreen reference={result.reference} token={result.token} />;
  }

  const field = (name: string, labelKey: string, extra?: { type?: string; placeholder?: string; inputMode?: "text" | "numeric" | "tel" | "email" | "decimal" }) => (
    <div className="space-y-1.5">
      <Label htmlFor={name} className="text-sm">{t(labelKey)}</Label>
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
        className="h-11"
      />
      {errors[name] && (
        <p id={`${name}-error`} role="alert" className="text-xs font-medium text-destructive">{errors[name]}</p>
      )}
    </div>
  );

  return (
    <div ref={topRef} className="mx-auto w-full max-w-4xl px-4 pb-32 pt-8 sm:px-6 sm:pt-12 lg:px-8">
      <header>
        <h1 className="font-serif text-2xl font-medium tracking-tight sm:text-3xl">{t("finance.apply.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("finance.apply.subtitle")}</p>
      </header>

      <div className="mt-6">
        <Progress value={(step / APPLY_STEPS.length) * 100} className="h-1.5" />
        <ol className="mt-3 grid grid-cols-3 gap-2 text-[11px] sm:grid-cols-6 sm:text-xs">
          {APPLY_STEPS.map((s) => (
            <li
              key={s.id}
              aria-current={s.id === step ? "step" : undefined}
              className={`truncate rounded-lg px-2 py-1.5 text-center font-medium ${
                s.id === step ? "bg-primary text-primary-foreground" : s.id < step ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
              }`}
            >
              {s.id}. {t(s.key)}
            </li>
          ))}
        </ol>
      </div>

      <Card className="mt-6 p-4 sm:p-6">
        {step === 1 && (
          <section className="grid gap-4 sm:grid-cols-2">
            {field("first_name", "finance.fields.firstName")}
            {field("last_name", "finance.fields.lastName")}
            {field("birth_date", "finance.fields.birthDate", { type: "date" })}
            {field("nationality", "finance.fields.nationality")}
            <div className="sm:col-span-2">{field("address", "finance.fields.address")}</div>
            {field("postal_code", "finance.fields.postalCode")}
            {field("city", "finance.fields.city")}
            {field("country", "finance.fields.country")}
            {field("phone", "finance.fields.phone", { type: "tel", inputMode: "tel" })}
            <div className="sm:col-span-2">{field("email", "finance.fields.email", { type: "email", inputMode: "email" })}</div>
          </section>
        )}

        {step === 2 && (
          <section className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="employment_status" className="text-sm">{t("finance.fields.employmentStatus")}</Label>
              <select
                id="employment_status"
                value={String(form.employment_status ?? "")}
                onChange={(e) => set("employment_status", e.target.value)}
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
            {field("profession", "finance.fields.profession")}
            {field("employer", "finance.fields.employer")}
            {field("seniority_months", "finance.fields.seniority", { inputMode: "numeric" })}
            {field("household_size", "finance.fields.household", { inputMode: "numeric" })}
            {field("monthly_income", "finance.fields.income", { inputMode: "decimal" })}
            {field("monthly_charges", "finance.fields.charges", { inputMode: "decimal" })}
            {field("other_income", "finance.fields.otherIncome", { inputMode: "decimal" })}
          </section>
        )}

        {step === 3 && (
          <section className="space-y-5">
            <Simulator products={products} value={loan} onChange={setLoan} compact />
            <div className="space-y-1.5">
              <Label htmlFor="purpose" className="text-sm">{t("finance.fields.purpose")}</Label>
              <Textarea
                id="purpose"
                value={String(form.purpose ?? "")}
                onChange={(e) => set("purpose", e.target.value)}
                rows={4}
                maxLength={500}
              />
            </div>
          </section>
        )}

        {step === 4 && (
          <section className="space-y-4">
            <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
              <Lock className="mr-1.5 inline h-3.5 w-3.5" aria-hidden />
              {t("finance.apply.bankNotice")}
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              {field("bank_holder", "finance.fields.bankHolder")}
              {field("bank_name", "finance.fields.bankName")}
              <div className="sm:col-span-2">{field("bank_iban", "finance.fields.iban", { placeholder: "FR76 …" })}</div>
              {field("bank_bic", "finance.fields.bic")}
            </div>
          </section>
        )}

        {step === 5 && (
          <section className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("finance.apply.documentsIntro")}</p>
            {documentTypes.map((d) => (
              <DocumentField
                key={d.slug}
                type={d}
                label={docLabel(d, t)}
                files={files[d.slug] ?? []}
                onChange={(list) => setFiles((f) => ({ ...f, [d.slug]: list }))}
              />
            ))}
          </section>
        )}

        {step === 6 && product && (
          <section className="space-y-5">
            <ReviewBlock title={t("apply.steps.identity", { defaultValue: t("finance.apply.steps.identity") })} onEdit={() => goTo(1)} rows={[
              [t("finance.fields.firstName"), String(form.first_name ?? "")],
              [t("finance.fields.lastName"), String(form.last_name ?? "")],
              [t("finance.fields.birthDate"), String(form.birth_date ?? "")],
              [t("finance.fields.address"), `${form.address ?? ""}, ${form.postal_code ?? ""} ${form.city ?? ""}, ${form.country ?? ""}`],
              [t("finance.fields.phone"), String(form.phone ?? "")],
              [t("finance.fields.email"), String(form.email ?? "")],
            ]} />
            <ReviewBlock title={t("finance.apply.steps.employment")} onEdit={() => goTo(2)} rows={[
              [t("finance.fields.employmentStatus"), form.employment_status ? t(`finance.employment.${form.employment_status}`) : ""],
              [t("finance.fields.profession"), String(form.profession ?? "")],
              [t("finance.fields.income"), formatMoney(Number(form.monthly_income ?? 0), product.currency, locale)],
              [t("finance.fields.charges"), formatMoney(Number(form.monthly_charges ?? 0), product.currency, locale)],
            ]} />
            <ReviewBlock title={t("finance.apply.steps.request")} onEdit={() => goTo(3)} rows={[
              [t("finance.sim.product"), productLabel(product, t)],
              [t("finance.sim.amount"), formatMoney(loan.amount, product.currency, locale)],
              [t("finance.sim.duration"), `${loan.months} ${t("finance.sim.months")}`],
              [t("finance.sim.insurance"), loan.insurance ? t("common.yes") : t("common.no")],
            ]} />
            <ReviewBlock title={t("finance.apply.steps.payout")} onEdit={() => goTo(4)} rows={[
              [t("finance.fields.bankHolder"), String(form.bank_holder ?? "")],
              [t("finance.fields.iban"), String(form.bank_iban ?? "")],
            ]} />
            <ReviewBlock title={t("finance.apply.steps.documents")} onEdit={() => goTo(5)} rows={documentTypes
              .filter((d) => files[d.slug]?.length)
              .map((d) => [docLabel(d, t), `${files[d.slug].length} ${t("finance.apply.fileCount")}`])} />

            <div className="space-y-3 rounded-xl border border-border p-4">
              {[
                ["consent_terms", "finance.apply.consentTerms"],
                ["consent_privacy", "finance.apply.consentPrivacy"],
                ["consent_marketing", "finance.apply.consentMarketing"],
              ].map(([key, labelKey]) => (
                <label key={key} className="flex items-start gap-3 text-sm leading-relaxed">
                  <Checkbox
                    checked={Boolean(form[key])}
                    onCheckedChange={(checked) => set(key, checked === true)}
                    aria-invalid={Boolean(errors[key])}
                    className="mt-0.5"
                  />
                  <span className={errors[key] ? "text-destructive" : "text-muted-foreground"}>{t(labelKey)}</span>
                </label>
              ))}
            </div>
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
            {t("finance.apply.submit")}
          </Button>
        )}
      </div>
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

function DocumentField({
  type, label, files, onChange,
}: { type: DocumentType; label: string; files: File[]; onChange: (files: File[]) => void }) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const accept = type.allowed_mime.join(",");
  const maxBytes = type.max_size_mb * 1024 * 1024;

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const accepted: File[] = [];
    for (const file of Array.from(list)) {
      if (!type.allowed_mime.includes(file.type)) {
        toast.error(t("finance.apply.badMime"));
        continue;
      }
      if (file.size > maxBytes) {
        toast.error(t("finance.apply.fileTooLarge", { size: type.max_size_mb }));
        continue;
      }
      accepted.push(file);
    }
    onChange(type.accepts_multiple ? [...files, ...accepted] : accepted.slice(0, 1));
  };

  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {label}
          {type.required && <span className="ml-1 text-destructive" aria-hidden>*</span>}
        </p>
        <span className="text-xs text-muted-foreground">{t("finance.apply.maxSize", { size: type.max_size_mb })}</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" className="min-h-10" onClick={() => inputRef.current?.click()}>
          <Paperclip className="h-4 w-4" aria-hidden />
          {t("finance.apply.chooseFile")}
        </Button>
        <Button type="button" variant="outline" size="sm" className="min-h-10" onClick={() => cameraRef.current?.click()}>
          <Camera className="h-4 w-4" aria-hidden />
          {t("finance.apply.takePhoto")}
        </Button>
      </div>

      <input
        ref={inputRef} type="file" accept={accept} multiple={type.accepts_multiple} className="sr-only"
        aria-label={label} onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
      />
      <input
        ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only"
        aria-label={`${label} — ${t("finance.apply.takePhoto")}`} onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
      />

      {files.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`} className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <button
                type="button"
                onClick={() => onChange(files.filter((_, i) => i !== index))}
                className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
                aria-label={t("common.delete")}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
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
