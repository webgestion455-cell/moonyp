-- =====================================================================
-- MOONYP — 06. Offres, contrats versionnés, signature électronique,
--              garanties, assurances, décaissements, échéanciers.
-- Dépend de : 01_core.sql, 02_rbac_staff.sql, 05_applications.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Offres de financement
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.application_offers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id   UUID NOT NULL REFERENCES public.loan_applications(id) ON DELETE CASCADE,
  amount           NUMERIC(14,2) NOT NULL,
  duration_months  INTEGER NOT NULL,
  annual_rate      NUMERIC(6,3) NOT NULL,
  monthly_payment  NUMERIC(12,2) NOT NULL,
  total_cost       NUMERIC(14,2) NOT NULL,
  insurance_total  NUMERIC(14,2) NOT NULL DEFAULT 0,
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

DROP POLICY IF EXISTS "offers_staff" ON public.application_offers;
CREATE POLICY "offers_staff" ON public.application_offers
  FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'applications.view'))
  WITH CHECK (public.has_permission(auth.uid(), 'applications.decide'));

DROP TRIGGER IF EXISTS trg_offers_updated ON public.application_offers;
CREATE TRIGGER trg_offers_updated
  BEFORE UPDATE ON public.application_offers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- Contrats (versionnés + empreintes documentaires)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.application_contracts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id        UUID NOT NULL REFERENCES public.loan_applications(id) ON DELETE CASCADE,
  offer_id              UUID REFERENCES public.application_offers(id) ON DELETE SET NULL,
  version               INTEGER NOT NULL DEFAULT 1,
  language              TEXT NOT NULL DEFAULT 'en',
  status                TEXT NOT NULL DEFAULT 'draft',  -- draft | sent | viewed | signed | cancelled
  provider              TEXT NOT NULL DEFAULT 'internal',
  storage_path          TEXT,
  signed_storage_path   TEXT,
  document_hash         TEXT,
  signed_document_hash  TEXT,
  sent_at               TIMESTAMPTZ,
  viewed_at             TIMESTAMPTZ,
  signed_at             TIMESTAMPTZ,
  signature_name        TEXT,
  signature_ip          TEXT,
  signature_method      TEXT,
  signature_hash        TEXT,
  created_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (application_id, version)
);
CREATE INDEX IF NOT EXISTS idx_contracts_app ON public.application_contracts(application_id);

GRANT SELECT, INSERT, UPDATE ON public.application_contracts TO authenticated;
GRANT ALL ON public.application_contracts TO service_role;
ALTER TABLE public.application_contracts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contracts_staff" ON public.application_contracts;
CREATE POLICY "contracts_staff" ON public.application_contracts
  FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'applications.view'))
  WITH CHECK (public.has_permission(auth.uid(), 'contracts.manage'));

DROP TRIGGER IF EXISTS trg_contracts_updated ON public.application_contracts;
CREATE TRIGGER trg_contracts_updated
  BEFORE UPDATE ON public.application_contracts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- Demandes de signature + preuves
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contract_signature_requests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id      UUID NOT NULL REFERENCES public.loan_applications(id) ON DELETE CASCADE,
  contract_id         UUID NOT NULL REFERENCES public.application_contracts(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL DEFAULT 'internal',
  provider_reference  TEXT,
  qualified           BOOLEAN NOT NULL DEFAULT false,
  status              TEXT NOT NULL DEFAULT 'pending',  -- pending | viewed | completed | expired | cancelled
  signer_name         TEXT,
  signer_email        TEXT,
  signer_ip           TEXT,
  signer_user_agent   TEXT,
  evidence            JSONB NOT NULL DEFAULT '{}'::jsonb,
  requested_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  viewed_at           TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  expires_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sig_requests_app ON public.contract_signature_requests(application_id);

GRANT SELECT ON public.contract_signature_requests TO authenticated;
GRANT ALL ON public.contract_signature_requests TO service_role;
ALTER TABLE public.contract_signature_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sig_requests_read_staff" ON public.contract_signature_requests;
CREATE POLICY "sig_requests_read_staff" ON public.contract_signature_requests
  FOR SELECT TO authenticated USING (public.has_permission(auth.uid(), 'applications.view'));

DROP TRIGGER IF EXISTS trg_sig_requests_updated ON public.contract_signature_requests;
CREATE TRIGGER trg_sig_requests_updated
  BEFORE UPDATE ON public.contract_signature_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.contract_signature_events (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signature_request_id  UUID NOT NULL REFERENCES public.contract_signature_requests(id) ON DELETE CASCADE,
  event_type            TEXT NOT NULL,
  actor                 TEXT NOT NULL DEFAULT 'applicant',
  ip                    TEXT,
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sig_events_request ON public.contract_signature_events(signature_request_id, created_at);

GRANT SELECT ON public.contract_signature_events TO authenticated;
GRANT ALL ON public.contract_signature_events TO service_role;
ALTER TABLE public.contract_signature_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sig_events_read_staff" ON public.contract_signature_events;
CREATE POLICY "sig_events_read_staff" ON public.contract_signature_events
  FOR SELECT TO authenticated USING (public.has_permission(auth.uid(), 'applications.view'));

-- ---------------------------------------------------------------------
-- Garanties (avec frais et suivi de paiement)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.application_guarantees (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id         UUID NOT NULL REFERENCES public.loan_applications(id) ON DELETE CASCADE,
  kind                   TEXT NOT NULL DEFAULT 'deposit',   -- deposit | surety | collateral
  guarantor_name         TEXT,
  amount                 NUMERIC(14,2),
  currency               TEXT NOT NULL DEFAULT 'EUR',
  storage_path           TEXT,
  signed_storage_path    TEXT,
  status                 TEXT NOT NULL DEFAULT 'pending',   -- pending | sent | signed | validated | cancelled
  sent_at                TIMESTAMPTZ,
  signed_at              TIMESTAMPTZ,
  fee_amount             NUMERIC(12,2) NOT NULL DEFAULT 0,
  fee_description        TEXT,
  client_choice          TEXT,                              -- pay_now | schedule | decline
  choice_at              TIMESTAMPTZ,
  scheduled_payment_date DATE,
  payment_status         TEXT NOT NULL DEFAULT 'not_required', -- not_required | pending | paid | rejected
  payment_reference      TEXT,
  payment_instructions   TEXT,
  payment_validated_at   TIMESTAMPTZ,
  payment_validated_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reminder_count         INTEGER NOT NULL DEFAULT 0,
  reminder_last_sent_at  TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_guarantees_app ON public.application_guarantees(application_id);

GRANT SELECT, INSERT, UPDATE ON public.application_guarantees TO authenticated;
GRANT ALL ON public.application_guarantees TO service_role;
ALTER TABLE public.application_guarantees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "guarantees_staff" ON public.application_guarantees;
CREATE POLICY "guarantees_staff" ON public.application_guarantees
  FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'applications.view'))
  WITH CHECK (public.has_permission(auth.uid(), 'guarantees.manage'));

DROP TRIGGER IF EXISTS trg_guarantees_updated ON public.application_guarantees;
CREATE TRIGGER trg_guarantees_updated
  BEFORE UPDATE ON public.application_guarantees
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- Assurances emprunteur
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.application_insurances (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id         UUID NOT NULL REFERENCES public.loan_applications(id) ON DELETE CASCADE,
  provider               TEXT,
  policy_number          TEXT,
  coverage               TEXT,
  monthly_premium        NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency               TEXT NOT NULL DEFAULT 'EUR',
  status                 TEXT NOT NULL DEFAULT 'pending',   -- pending | sent | validated | declined
  required               BOOLEAN NOT NULL DEFAULT false,
  storage_path           TEXT,
  starts_on              DATE,
  due_date               DATE,
  admin_notes            TEXT,
  sent_at                TIMESTAMPTZ,
  validated_at           TIMESTAMPTZ,
  fee_amount             NUMERIC(12,2) NOT NULL DEFAULT 0,
  fee_description        TEXT,
  client_choice          TEXT,
  choice_at              TIMESTAMPTZ,
  scheduled_payment_date DATE,
  payment_status         TEXT NOT NULL DEFAULT 'not_required',
  payment_reference      TEXT,
  payment_instructions   TEXT,
  payment_validated_at   TIMESTAMPTZ,
  payment_validated_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_insurances_app ON public.application_insurances(application_id);

GRANT SELECT, INSERT, UPDATE ON public.application_insurances TO authenticated;
GRANT ALL ON public.application_insurances TO service_role;
ALTER TABLE public.application_insurances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "insurances_staff" ON public.application_insurances;
CREATE POLICY "insurances_staff" ON public.application_insurances
  FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'applications.view'))
  WITH CHECK (public.has_permission(auth.uid(), 'insurances.manage'));

DROP TRIGGER IF EXISTS trg_insurances_updated ON public.application_insurances;
CREATE TRIGGER trg_insurances_updated
  BEFORE UPDATE ON public.application_insurances
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- Décaissements
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
  status          TEXT NOT NULL DEFAULT 'preparing',  -- preparing | sent | confirmed | failed | cancelled
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

DROP POLICY IF EXISTS "disbursements_staff" ON public.disbursements;
CREATE POLICY "disbursements_staff" ON public.disbursements
  FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'applications.view'))
  WITH CHECK (public.has_permission(auth.uid(), 'disbursements.manage'));

DROP TRIGGER IF EXISTS trg_disbursements_updated ON public.disbursements;
CREATE TRIGGER trg_disbursements_updated
  BEFORE UPDATE ON public.disbursements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- Échéancier de remboursement
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.repayment_schedule (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id     UUID NOT NULL REFERENCES public.loan_applications(id) ON DELETE CASCADE,
  installment_no     INTEGER NOT NULL,
  due_date           DATE NOT NULL,
  amount             NUMERIC(12,2) NOT NULL,
  principal          NUMERIC(12,2) NOT NULL DEFAULT 0,
  interest           NUMERIC(12,2) NOT NULL DEFAULT 0,
  insurance          NUMERIC(12,2) NOT NULL DEFAULT 0,
  remaining_balance  NUMERIC(14,2) NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'upcoming',  -- upcoming | paid | late | cancelled
  paid               BOOLEAN NOT NULL DEFAULT false,
  paid_amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid_at            TIMESTAMPTZ,
  notes              TEXT,
  reminder_sent_at   TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (application_id, installment_no)
);
CREATE INDEX IF NOT EXISTS idx_repayment_app ON public.repayment_schedule(application_id, installment_no);
CREATE INDEX IF NOT EXISTS idx_repayment_due ON public.repayment_schedule(due_date) WHERE paid = false;

GRANT SELECT, INSERT, UPDATE ON public.repayment_schedule TO authenticated;
GRANT ALL ON public.repayment_schedule TO service_role;
ALTER TABLE public.repayment_schedule ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "repayment_staff" ON public.repayment_schedule;
CREATE POLICY "repayment_staff" ON public.repayment_schedule
  FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'applications.view'))
  WITH CHECK (public.has_permission(auth.uid(), 'repayments.manage'));

DROP TRIGGER IF EXISTS trg_repayment_schedule_updated ON public.repayment_schedule;
CREATE TRIGGER trg_repayment_schedule_updated
  BEFORE UPDATE ON public.repayment_schedule
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
