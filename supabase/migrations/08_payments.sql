-- =====================================================================
-- MOONYP — 08. Paiements des dossiers (frais de garantie, primes
--              d'assurance, échéances) et pièces justificatives.
-- Dépend de : 01_core.sql, 02_rbac_staff.sql, 04_catalog.sql
--             (payment_methods), 05_applications.sql,
--             06_contracts.sql (repayment_schedule).
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.application_payments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id      UUID NOT NULL REFERENCES public.loan_applications(id) ON DELETE CASCADE,
  purpose             TEXT NOT NULL DEFAULT 'other',   -- guarantee_fee | insurance_fee | installment | other
  installment_id      UUID REFERENCES public.repayment_schedule(id) ON DELETE SET NULL,
  method_id           UUID REFERENCES public.payment_methods(id) ON DELETE SET NULL,
  provider            TEXT NOT NULL DEFAULT 'bank_transfer',
  provider_reference  TEXT,
  reference           TEXT NOT NULL,
  amount              NUMERIC(12,2) NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'EUR',
  status              TEXT NOT NULL DEFAULT 'pending',  -- pending | processing | paid | rejected | cancelled
  instructions        TEXT,
  receipt_path        TEXT,
  admin_notes         TEXT,
  received_at         TIMESTAMPTZ,
  validated_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_app_payments_app ON public.application_payments(application_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_payments_status ON public.application_payments(status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_payments_reference ON public.application_payments(reference);

GRANT SELECT, INSERT, UPDATE ON public.application_payments TO authenticated;
GRANT ALL ON public.application_payments TO service_role;
ALTER TABLE public.application_payments ENABLE ROW LEVEL SECURITY;

-- Le demandeur (sans compte) passe par les server functions (service_role).
DROP POLICY IF EXISTS "app_payments_staff" ON public.application_payments;
CREATE POLICY "app_payments_staff" ON public.application_payments
  FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'applications.view'))
  WITH CHECK (public.has_permission(auth.uid(), 'payments.manage'));

DROP TRIGGER IF EXISTS trg_application_payments_updated ON public.application_payments;
CREATE TRIGGER trg_application_payments_updated
  BEFORE UPDATE ON public.application_payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
