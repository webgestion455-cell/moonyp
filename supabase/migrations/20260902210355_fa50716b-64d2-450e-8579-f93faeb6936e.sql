-- ============ Contrats : versionnage ============
ALTER TABLE public.application_contracts
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS document_hash text,
  ADD COLUMN IF NOT EXISTS signed_document_hash text,
  ADD COLUMN IF NOT EXISTS viewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'internal_aes',
  ADD COLUMN IF NOT EXISTS created_by uuid;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contracts_app_version
  ON public.application_contracts(application_id, version);

-- ============ Demandes de signature ============
CREATE TABLE IF NOT EXISTS public.contract_signature_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id      uuid NOT NULL REFERENCES public.loan_applications(id) ON DELETE CASCADE,
  contract_id         uuid NOT NULL REFERENCES public.application_contracts(id) ON DELETE CASCADE,
  provider            text NOT NULL DEFAULT 'internal_aes',
  provider_reference  text,
  qualified           boolean NOT NULL DEFAULT false,
  status              text NOT NULL DEFAULT 'created',
  signer_name         text,
  signer_email        text,
  signer_ip           text,
  signer_user_agent   text,
  evidence            jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_at        timestamptz NOT NULL DEFAULT now(),
  viewed_at           timestamptz,
  completed_at        timestamptz,
  expires_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sig_requests_app ON public.contract_signature_requests(application_id);

GRANT SELECT ON public.contract_signature_requests TO authenticated;
GRANT ALL ON public.contract_signature_requests TO service_role;
ALTER TABLE public.contract_signature_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sig_requests_read_staff" ON public.contract_signature_requests;
CREATE POLICY "sig_requests_read_staff" ON public.contract_signature_requests
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP TRIGGER IF EXISTS trg_sig_requests_updated ON public.contract_signature_requests;
CREATE TRIGGER trg_sig_requests_updated
  BEFORE UPDATE ON public.contract_signature_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ Événements de signature ============
CREATE TABLE IF NOT EXISTS public.contract_signature_events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signature_request_id  uuid NOT NULL REFERENCES public.contract_signature_requests(id) ON DELETE CASCADE,
  event_type            text NOT NULL,
  actor                 text NOT NULL DEFAULT 'applicant',
  ip                    text,
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sig_events_request ON public.contract_signature_events(signature_request_id, created_at);

GRANT SELECT ON public.contract_signature_events TO authenticated;
GRANT ALL ON public.contract_signature_events TO service_role;
ALTER TABLE public.contract_signature_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sig_events_read_staff" ON public.contract_signature_events;
CREATE POLICY "sig_events_read_staff" ON public.contract_signature_events
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ============ Garanties : frais et choix du client ============
ALTER TABLE public.application_guarantees
  ADD COLUMN IF NOT EXISTS fee_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_description text,
  ADD COLUMN IF NOT EXISTS client_choice text,
  ADD COLUMN IF NOT EXISTS choice_at timestamptz,
  ADD COLUMN IF NOT EXISTS scheduled_payment_date date,
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS payment_reference text,
  ADD COLUMN IF NOT EXISTS payment_instructions text,
  ADD COLUMN IF NOT EXISTS payment_validated_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_validated_by uuid,
  ADD COLUMN IF NOT EXISTS reminder_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reminder_last_sent_at timestamptz;

-- ============ Assurance : étape distincte ============
ALTER TABLE public.application_insurances
  ADD COLUMN IF NOT EXISTS required boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS admin_notes text,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz;