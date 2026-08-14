-- =====================================================================
-- MOONYP — 06. Offres, contrats, signature électronique, décaissements
--              et échéanciers de remboursement.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.application_offers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id   UUID NOT NULL REFERENCES public.loan_applications(id) ON DELETE CASCADE,
  amount           NUMERIC(14,2) NOT NULL,
  duration_months  INTEGER NOT NULL,
  annual_rate      NUMERIC(6,3) NOT NULL,
  monthly_payment  NUMERIC(12,2) NOT NULL,
  total_cost       NUMERIC(14,2) NOT NULL,
  insurance_total  NUMERIC(12,2) NOT NULL DEFAULT 0,
  fees_total       NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency         TEXT NOT NULL DEFAULT 'EUR',
  valid_until      TIMESTAMPTZ,
  accepted_at      TIMESTAMPTZ,
  declined_at      TIMESTAMPTZ,
  created_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_offers_app ON public.application_offers(application_id);

GRANT SELECT, INSERT, UPDATE ON public.application_offers TO authenticated;
GRANT ALL ON public.application_offers TO service_role;
ALTER TABLE public.application_offers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "offers_read_staff" ON public.application_offers;
CREATE POLICY "offers_read_staff" ON public.application_offers
  FOR SELECT TO authenticated USING (public.has_permission(auth.uid(), 'applications.view'));

DROP POLICY IF EXISTS "offers_manage_staff" ON public.application_offers;
CREATE POLICY "offers_manage_staff" ON public.application_offers
  FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'applications.decide'))
  WITH CHECK (public.has_permission(auth.uid(), 'applications.decide'));

DROP TRIGGER IF EXISTS trg_offers_updated ON public.application_offers;
CREATE TRIGGER trg_offers_updated
  BEFORE UPDATE ON public.application_offers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.application_contracts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id       UUID NOT NULL REFERENCES public.loan_applications(id) ON DELETE CASCADE,
  offer_id             UUID REFERENCES public.application_offers(id) ON DELETE SET NULL,
  language             TEXT NOT NULL DEFAULT 'en',
  storage_path         TEXT,
  signed_storage_path  TEXT,
  sent_at              TIMESTAMPTZ,
  signed_at            TIMESTAMPTZ,
  signature_name       TEXT,
  signature_ip         TEXT,
  signature_method     TEXT,          -- otp | drawn | typed
  signature_hash       TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contracts_app ON public.application_contracts(application_id);

GRANT SELECT, INSERT, UPDATE ON public.application_contracts TO authenticated;
GRANT ALL ON public.application_contracts TO service_role;
ALTER TABLE public.application_contracts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contracts_read_staff" ON public.application_contracts;
CREATE POLICY "contracts_read_staff" ON public.application_contracts
  FOR SELECT TO authenticated USING (public.has_permission(auth.uid(), 'applications.view'));

DROP POLICY IF EXISTS "contracts_manage_staff" ON public.application_contracts;
CREATE POLICY "contracts_manage_staff" ON public.application_contracts
  FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'contracts.manage'))
  WITH CHECK (public.has_permission(auth.uid(), 'contracts.manage'));

DROP TRIGGER IF EXISTS trg_contracts_updated ON public.application_contracts;
CREATE TRIGGER trg_contracts_updated
  BEFORE UPDATE ON public.application_contracts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.disbursements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  UUID NOT NULL REFERENCES public.loan_applications(id) ON DELETE CASCADE,
  amount          NUMERIC(14,2) NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'EUR',
  beneficiary     TEXT,
  iban            TEXT,
  bic             TEXT,
  bank_name       TEXT,
  reference       TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending | processing | sent | failed
  receipt_path    TEXT,
  admin_notes     TEXT,
  processed_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  processed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_disbursements_app ON public.disbursements(application_id);

GRANT SELECT, INSERT, UPDATE ON public.disbursements TO authenticated;
GRANT ALL ON public.disbursements TO service_role;
ALTER TABLE public.disbursements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "disbursements_read_staff" ON public.disbursements;
CREATE POLICY "disbursements_read_staff" ON public.disbursements
  FOR SELECT TO authenticated USING (public.has_permission(auth.uid(), 'applications.view'));

DROP POLICY IF EXISTS "disbursements_manage_staff" ON public.disbursements;
CREATE POLICY "disbursements_manage_staff" ON public.disbursements
  FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'disbursements.manage'))
  WITH CHECK (public.has_permission(auth.uid(), 'disbursements.manage'));

DROP TRIGGER IF EXISTS trg_disbursements_updated ON public.disbursements;
CREATE TRIGGER trg_disbursements_updated
  BEFORE UPDATE ON public.disbursements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.repayment_schedule (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id    UUID NOT NULL REFERENCES public.loan_applications(id) ON DELETE CASCADE,
  installment_no    INTEGER NOT NULL,
  due_date          DATE NOT NULL,
  amount            NUMERIC(12,2) NOT NULL,
  principal         NUMERIC(12,2) NOT NULL DEFAULT 0,
  interest          NUMERIC(12,2) NOT NULL DEFAULT 0,
  insurance         NUMERIC(12,2) NOT NULL DEFAULT 0,
  remaining_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  paid              BOOLEAN NOT NULL DEFAULT false,
  paid_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (application_id, installment_no)
);
CREATE INDEX IF NOT EXISTS idx_repayment_app ON public.repayment_schedule(application_id, installment_no);

GRANT SELECT, INSERT, UPDATE ON public.repayment_schedule TO authenticated;
GRANT ALL ON public.repayment_schedule TO service_role;
ALTER TABLE public.repayment_schedule ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "repayment_read_staff" ON public.repayment_schedule;
CREATE POLICY "repayment_read_staff" ON public.repayment_schedule
  FOR SELECT TO authenticated USING (public.has_permission(auth.uid(), 'applications.view'));

DROP POLICY IF EXISTS "repayment_manage_staff" ON public.repayment_schedule;
CREATE POLICY "repayment_manage_staff" ON public.repayment_schedule
  FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'disbursements.manage'))
  WITH CHECK (public.has_permission(auth.uid(), 'disbursements.manage'));
