-- 1. Moyens de paiement configurables
CREATE TABLE IF NOT EXISTS public.payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'bank_transfer',
  kind text NOT NULL DEFAULT 'bank_transfer',
  label text NOT NULL,
  holder text,
  iban text,
  bic text,
  bank_name text,
  card_brand text,
  card_last4 text,
  address text,
  network text,
  qr_url text,
  instructions text,
  currency text NOT NULL DEFAULT 'EUR',
  min_amount numeric,
  max_amount numeric,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_methods TO authenticated;
GRANT ALL ON public.payment_methods TO service_role;

ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff manage payment methods" ON public.payment_methods;
CREATE POLICY "Staff manage payment methods"
ON public.payment_methods FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS trg_payment_methods_updated ON public.payment_methods;
CREATE TRIGGER trg_payment_methods_updated
BEFORE UPDATE ON public.payment_methods
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Paiements rattachés à un dossier
CREATE TABLE IF NOT EXISTS public.application_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.loan_applications(id) ON DELETE CASCADE,
  purpose text NOT NULL DEFAULT 'other',
  installment_id uuid REFERENCES public.repayment_schedule(id) ON DELETE SET NULL,
  method_id uuid REFERENCES public.payment_methods(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'bank_transfer',
  provider_reference text,
  reference text NOT NULL,
  amount numeric NOT NULL,
  currency text NOT NULL DEFAULT 'EUR',
  status text NOT NULL DEFAULT 'pending',
  instructions text,
  receipt_path text,
  admin_notes text,
  received_at timestamptz,
  validated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS application_payments_reference_key ON public.application_payments (reference);
CREATE INDEX IF NOT EXISTS application_payments_application_idx ON public.application_payments (application_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.application_payments TO authenticated;
GRANT ALL ON public.application_payments TO service_role;

ALTER TABLE public.application_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff manage application payments" ON public.application_payments;
CREATE POLICY "Staff manage application payments"
ON public.application_payments FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS trg_application_payments_updated ON public.application_payments;
CREATE TRIGGER trg_application_payments_updated
BEFORE UPDATE ON public.application_payments
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Échéancier enrichi
ALTER TABLE public.repayment_schedule
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'upcoming',
  ADD COLUMN IF NOT EXISTS paid_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_repayment_schedule_updated ON public.repayment_schedule;
CREATE TRIGGER trg_repayment_schedule_updated
BEFORE UPDATE ON public.repayment_schedule
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

UPDATE public.repayment_schedule SET status = 'paid' WHERE paid = true AND status = 'upcoming';

-- 4. Frais d'assurance
ALTER TABLE public.application_insurances
  ADD COLUMN IF NOT EXISTS fee_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_description text,
  ADD COLUMN IF NOT EXISTS client_choice text,
  ADD COLUMN IF NOT EXISTS choice_at timestamptz,
  ADD COLUMN IF NOT EXISTS scheduled_payment_date date,
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS payment_reference text,
  ADD COLUMN IF NOT EXISTS payment_instructions text,
  ADD COLUMN IF NOT EXISTS payment_validated_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_validated_by uuid;