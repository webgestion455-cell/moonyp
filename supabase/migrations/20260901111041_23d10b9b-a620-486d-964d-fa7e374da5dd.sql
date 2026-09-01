-- ============================================================
-- 1. LOAN PRODUCTS — per-product business rules
-- ============================================================
ALTER TABLE public.loan_products
  ADD COLUMN IF NOT EXISTS repayment_frequency text NOT NULL DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS grace_period_months integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS early_repayment_fee_percent numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_dti_percent numeric NOT NULL DEFAULT 35,
  ADD COLUMN IF NOT EXISTS requires_income_proof boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS requires_collateral boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allowed_id_documents text[] NOT NULL DEFAULT ARRAY['national_id','passport','driving_licence']::text[];

ALTER TABLE public.loan_products
  DROP CONSTRAINT IF EXISTS loan_products_frequency_chk;
ALTER TABLE public.loan_products
  ADD CONSTRAINT loan_products_frequency_chk
  CHECK (repayment_frequency IN ('monthly','quarterly','semiannual','annual'));

ALTER TABLE public.loan_products
  DROP CONSTRAINT IF EXISTS loan_products_range_chk;
ALTER TABLE public.loan_products
  ADD CONSTRAINT loan_products_range_chk
  CHECK (min_amount > 0 AND max_amount >= min_amount AND min_months > 0 AND max_months >= min_months
         AND amount_step > 0 AND months_step > 0);

UPDATE public.loan_products SET
  min_amount = 1000, max_amount = 150000, amount_step = 500,
  min_months = 6, max_months = 120, months_step = 6,
  max_dti_percent = 35, early_repayment_fee_percent = 1.0,
  allowed_id_documents = ARRAY['national_id','passport','driving_licence','residence_permit']::text[]
WHERE slug = 'personal';

UPDATE public.loan_products SET
  min_amount = 3000, max_amount = 250000, amount_step = 500,
  min_months = 12, max_months = 96, months_step = 6,
  max_dti_percent = 35, early_repayment_fee_percent = 1.0,
  allowed_id_documents = ARRAY['national_id','passport','driving_licence','residence_permit']::text[]
WHERE slug = 'auto';

UPDATE public.loan_products SET
  min_amount = 25000, max_amount = 5000000, amount_step = 5000,
  min_months = 60, max_months = 360, months_step = 12,
  max_dti_percent = 33, early_repayment_fee_percent = 3.0, requires_collateral = true,
  allowed_id_documents = ARRAY['national_id','passport','residence_permit']::text[]
WHERE slug = 'mortgage';

UPDATE public.loan_products SET
  min_amount = 5000, max_amount = 500000000, amount_step = 1000,
  min_months = 12, max_months = 240, months_step = 6,
  max_dti_percent = 40, early_repayment_fee_percent = 2.0, requires_collateral = true,
  allowed_id_documents = ARRAY['national_id','passport','residence_permit']::text[]
WHERE slug = 'business';

-- ============================================================
-- 2. DOCUMENT TYPES — KYC driven by data, not hardcoded UI
-- ============================================================
ALTER TABLE public.document_types
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS capture_mode text NOT NULL DEFAULT 'upload',
  ADD COLUMN IF NOT EXISTS sides integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS employment_statuses text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS countries text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS product_slugs text[] NOT NULL DEFAULT ARRAY[]::text[];

ALTER TABLE public.document_types DROP CONSTRAINT IF EXISTS document_types_category_chk;
ALTER TABLE public.document_types
  ADD CONSTRAINT document_types_category_chk
  CHECK (category IN ('identity','address','income','bank','selfie','other'));

ALTER TABLE public.document_types DROP CONSTRAINT IF EXISTS document_types_capture_chk;
ALTER TABLE public.document_types
  ADD CONSTRAINT document_types_capture_chk
  CHECK (capture_mode IN ('scan','scan_double','selfie','upload'));

-- Reset the catalog to the compliant KYC journey.
UPDATE public.document_types SET active = false;

INSERT INTO public.document_types
  (slug, i18n_key, label, required, accepts_multiple, max_size_mb, allowed_mime, active, sort_order,
   category, capture_mode, sides, employment_statuses, countries, product_slugs)
VALUES
  ('id_national_id','kyc.docs.nationalId','Carte nationale d''identité', true, false, 10,
   ARRAY['image/jpeg','image/png','image/webp','application/pdf'], true, 10,
   'identity','scan_double',2,ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[]),
  ('id_passport','kyc.docs.passport','Passeport', true, false, 10,
   ARRAY['image/jpeg','image/png','image/webp','application/pdf'], true, 11,
   'identity','scan',1,ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[]),
  ('id_driving_licence','kyc.docs.drivingLicence','Permis de conduire', true, false, 10,
   ARRAY['image/jpeg','image/png','image/webp','application/pdf'], true, 12,
   'identity','scan_double',2,ARRAY[]::text[],ARRAY[]::text[],ARRAY['personal','auto']::text[]),
  ('id_residence_permit','kyc.docs.residencePermit','Titre de séjour', true, false, 10,
   ARRAY['image/jpeg','image/png','image/webp','application/pdf'], true, 13,
   'identity','scan_double',2,ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[]),

  ('address_electricity','kyc.docs.electricity','Facture d''électricité', true, false, 10,
   ARRAY['image/jpeg','image/png','image/webp','application/pdf'], true, 20,
   'address','scan',1,ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[]),
  ('address_water','kyc.docs.water','Facture d''eau', true, false, 10,
   ARRAY['image/jpeg','image/png','image/webp','application/pdf'], true, 21,
   'address','scan',1,ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[]),
  ('address_telecom','kyc.docs.telecom','Facture téléphone / internet', true, false, 10,
   ARRAY['image/jpeg','image/png','image/webp','application/pdf'], true, 22,
   'address','scan',1,ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[]),
  ('address_hosting','kyc.docs.hosting','Attestation d''hébergement', true, false, 10,
   ARRAY['image/jpeg','image/png','image/webp','application/pdf'], true, 23,
   'address','upload',1,ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[]),

  ('selfie_liveness','kyc.docs.selfie','Vérification du visage', true, false, 8,
   ARRAY['image/jpeg','image/png','image/webp'], true, 30,
   'selfie','selfie',1,ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[]),

  ('bank_statement','kyc.docs.bankStatement','Relevé bancaire (3 derniers mois)', true, true, 15,
   ARRAY['image/jpeg','image/png','image/webp','application/pdf'], true, 40,
   'bank','upload',1,ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[]),

  ('income_payslip','kyc.docs.payslip','Bulletins de salaire (3 derniers mois)', true, true, 15,
   ARRAY['image/jpeg','image/png','image/webp','application/pdf'], true, 50,
   'income','upload',1,ARRAY['employee','civil_servant']::text[],ARRAY[]::text[],ARRAY[]::text[]),
  ('income_tax_return','kyc.docs.taxReturn','Avis d''imposition', true, false, 15,
   ARRAY['image/jpeg','image/png','image/webp','application/pdf'], true, 51,
   'income','upload',1,ARRAY['self_employed','business_owner','other']::text[],ARRAY[]::text[],ARRAY[]::text[]),
  ('income_pension','kyc.docs.pension','Attestation de pension', true, false, 15,
   ARRAY['image/jpeg','image/png','image/webp','application/pdf'], true, 52,
   'income','upload',1,ARRAY['retired']::text[],ARRAY[]::text[],ARRAY[]::text[]),
  ('income_benefits','kyc.docs.benefits','Attestation d''allocations', false, false, 15,
   ARRAY['image/jpeg','image/png','image/webp','application/pdf'], true, 53,
   'income','upload',1,ARRAY['unemployed','student']::text[],ARRAY[]::text[],ARRAY[]::text[]),
  ('income_kbis','kyc.docs.kbis','Extrait Kbis / registre du commerce', true, false, 15,
   ARRAY['image/jpeg','image/png','image/webp','application/pdf'], true, 54,
   'income','upload',1,ARRAY['self_employed','business_owner']::text[],ARRAY[]::text[],ARRAY['business']::text[])
ON CONFLICT (slug) DO UPDATE SET
  i18n_key = EXCLUDED.i18n_key,
  label = EXCLUDED.label,
  required = EXCLUDED.required,
  accepts_multiple = EXCLUDED.accepts_multiple,
  max_size_mb = EXCLUDED.max_size_mb,
  allowed_mime = EXCLUDED.allowed_mime,
  active = true,
  sort_order = EXCLUDED.sort_order,
  category = EXCLUDED.category,
  capture_mode = EXCLUDED.capture_mode,
  sides = EXCLUDED.sides,
  employment_statuses = EXCLUDED.employment_statuses,
  countries = EXCLUDED.countries,
  product_slugs = EXCLUDED.product_slugs;

-- ============================================================
-- 3. LOAN APPLICATIONS — pricing snapshot, KYC state, compliance
-- ============================================================
ALTER TABLE public.loan_applications
  ADD COLUMN IF NOT EXISTS bank_country text,
  ADD COLUMN IF NOT EXISTS kyc_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS kyc_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS monthly_payment numeric,
  ADD COLUMN IF NOT EXISTS insurance_monthly numeric,
  ADD COLUMN IF NOT EXISTS total_interest numeric,
  ADD COLUMN IF NOT EXISTS total_cost numeric,
  ADD COLUMN IF NOT EXISTS apr numeric,
  ADD COLUMN IF NOT EXISTS fees numeric,
  ADD COLUMN IF NOT EXISTS first_instalment_on date,
  ADD COLUMN IF NOT EXISTS dti_percent numeric,
  ADD COLUMN IF NOT EXISTS compliance_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS review_required boolean NOT NULL DEFAULT false;

ALTER TABLE public.loan_applications DROP CONSTRAINT IF EXISTS loan_applications_kyc_status_chk;
ALTER TABLE public.loan_applications
  ADD CONSTRAINT loan_applications_kyc_status_chk
  CHECK (kyc_status IN ('pending','in_progress','submitted','under_review','verified','failed'));

CREATE INDEX IF NOT EXISTS loan_applications_status_idx ON public.loan_applications (status);
CREATE INDEX IF NOT EXISTS loan_applications_kyc_status_idx ON public.loan_applications (kyc_status);
CREATE INDEX IF NOT EXISTS loan_applications_review_idx ON public.loan_applications (review_required) WHERE review_required;
CREATE INDEX IF NOT EXISTS loan_applications_created_idx ON public.loan_applications (created_at DESC);

-- ============================================================
-- 4. KYC STEP TRACKING
-- ============================================================
CREATE TABLE IF NOT EXISTS public.application_kyc_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.loan_applications(id) ON DELETE CASCADE,
  step_key text NOT NULL,
  category text NOT NULL,
  document_type_slug text,
  document_id uuid REFERENCES public.application_documents(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'todo',
  attempts integer NOT NULL DEFAULT 0,
  provider text,
  provider_reference text,
  score numeric,
  review_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id, step_key)
);

ALTER TABLE public.application_kyc_checks DROP CONSTRAINT IF EXISTS application_kyc_checks_status_chk;
ALTER TABLE public.application_kyc_checks
  ADD CONSTRAINT application_kyc_checks_status_chk
  CHECK (status IN ('todo','in_progress','capturing','verifying','passed','failed','retry','manual_review'));

GRANT SELECT, INSERT, UPDATE ON public.application_kyc_checks TO authenticated;
GRANT ALL ON public.application_kyc_checks TO service_role;

ALTER TABLE public.application_kyc_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read kyc checks" ON public.application_kyc_checks;
CREATE POLICY "Staff read kyc checks" ON public.application_kyc_checks
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Staff update kyc checks" ON public.application_kyc_checks;
CREATE POLICY "Staff update kyc checks" ON public.application_kyc_checks
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE INDEX IF NOT EXISTS application_kyc_checks_app_idx ON public.application_kyc_checks (application_id);

DROP TRIGGER IF EXISTS trg_kyc_checks_updated ON public.application_kyc_checks;
CREATE TRIGGER trg_kyc_checks_updated
  BEFORE UPDATE ON public.application_kyc_checks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();