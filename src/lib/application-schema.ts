import { z } from "zod";

/**
 * Validation shared by the multi-step form (client feedback) and by the server
 * functions (authoritative). Never trust the client copy alone.
 */

const trimmed = (max: number) => z.string().trim().max(max);
const required = (max: number, key: string) => trimmed(max).min(1, key);

export const identitySchema = z.object({
  first_name: required(80, "validation.required"),
  last_name: required(80, "validation.required"),
  birth_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "validation.date")
    .refine((v) => {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return false;
      const age = (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
      return age >= 18 && age <= 100;
    }, "validation.age"),
  nationality: trimmed(80).optional().default(""),
  address: required(200, "validation.required"),
  postal_code: required(20, "validation.required"),
  city: required(120, "validation.required"),
  country: required(80, "validation.required"),
  phone: required(32, "validation.required").regex(/^[+0-9 ().-]{6,32}$/, "validation.phone"),
  email: trimmed(255).email("validation.email"),
});

export const employmentSchema = z.object({
  employment_status: required(60, "validation.required"),
  profession: trimmed(120).optional().default(""),
  employer: trimmed(160).optional().default(""),
  seniority_months: z.coerce.number().int().min(0).max(720),
  monthly_income: z.coerce.number().min(0).max(10_000_000),
  monthly_charges: z.coerce.number().min(0).max(10_000_000),
  other_income: z.coerce.number().min(0).max(10_000_000).optional().default(0),
  household_size: z.coerce.number().int().min(1).max(20).optional().default(1),
});

export const requestSchema = z.object({
  product_id: z.string().uuid("validation.required"),
  amount: z.coerce.number().positive("validation.required"),
  duration_months: z.coerce.number().int().positive("validation.required"),
  purpose: trimmed(500).optional().default(""),
  insurance_opted: z.boolean().optional().default(false),
});

export const payoutSchema = z.object({
  bank_holder: required(160, "validation.required"),
  bank_name: trimmed(160).optional().default(""),
  bank_iban: required(40, "validation.required")
    .transform((v) => v.replace(/\s+/g, "").toUpperCase())
    .refine((v) => /^[A-Z]{2}[0-9A-Z]{13,32}$/.test(v), "validation.iban"),
  bank_bic: trimmed(15)
    .transform((v) => v.replace(/\s+/g, "").toUpperCase())
    .refine((v) => v === "" || /^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(v), "validation.bic")
    .optional()
    .default(""),
});

export const consentSchema = z.object({
  consent_terms: z.literal(true, { errorMap: () => ({ message: "validation.consent" }) }),
  consent_privacy: z.literal(true, { errorMap: () => ({ message: "validation.consent" }) }),
  consent_marketing: z.boolean().optional().default(false),
});

export const draftPayloadSchema = identitySchema
  .partial()
  .merge(employmentSchema.partial())
  .merge(requestSchema.partial())
  .merge(payoutSchema.partial())
  .extend({
    language: z.string().min(2).max(5).optional(),
    current_step: z.coerce.number().int().min(1).max(6).optional(),
  });

export const submitPayloadSchema = identitySchema
  .merge(employmentSchema)
  .merge(requestSchema)
  .merge(payoutSchema)
  .merge(consentSchema)
  .extend({ language: z.string().min(2).max(5).default("fr") });

export type IdentityValues = z.infer<typeof identitySchema>;
export type EmploymentValues = z.infer<typeof employmentSchema>;
export type RequestValues = z.infer<typeof requestSchema>;
export type PayoutValues = z.infer<typeof payoutSchema>;
export type SubmitPayload = z.infer<typeof submitPayloadSchema>;

export const APPLY_STEPS = [
  { id: 1, key: "apply.steps.identity" },
  { id: 2, key: "apply.steps.employment" },
  { id: 3, key: "apply.steps.request" },
  { id: 4, key: "apply.steps.payout" },
  { id: 5, key: "apply.steps.documents" },
  { id: 6, key: "apply.steps.review" },
] as const;

export const EMPLOYMENT_STATUSES = [
  "employee",
  "civil_servant",
  "self_employed",
  "business_owner",
  "retired",
  "student",
  "unemployed",
  "other",
] as const;

/** Storage draft key — progress is kept locally until submission. */
export const APPLY_DRAFT_KEY = "bnpparibas.apply.draft.v1";
