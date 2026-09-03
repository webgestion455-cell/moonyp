-- 1. Extension du workflow de statuts (extensible)
ALTER TYPE public.application_status ADD VALUE IF NOT EXISTS 'guarantee_sent' AFTER 'contract_signed';
ALTER TYPE public.application_status ADD VALUE IF NOT EXISTS 'guarantee_signed' AFTER 'guarantee_sent';
ALTER TYPE public.application_status ADD VALUE IF NOT EXISTS 'insurance_pending' AFTER 'guarantee_signed';
ALTER TYPE public.application_status ADD VALUE IF NOT EXISTS 'insurance_validated' AFTER 'insurance_pending';

-- 2. Demandes d'informations complémentaires
CREATE TABLE IF NOT EXISTS public.application_info_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.loan_applications(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'information',
  document_type_slug text,
  document_id uuid REFERENCES public.application_documents(id) ON DELETE SET NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  response_text text,
  responded_at timestamptz,
  requested_by uuid,
  due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_info_requests_application ON public.application_info_requests(application_id, status);

GRANT SELECT, INSERT, UPDATE ON public.application_info_requests TO authenticated;
GRANT ALL ON public.application_info_requests TO service_role;

ALTER TABLE public.application_info_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff manage info requests" ON public.application_info_requests;
CREATE POLICY "Staff manage info requests"
  ON public.application_info_requests FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP TRIGGER IF EXISTS trg_info_requests_updated ON public.application_info_requests;
CREATE TRIGGER trg_info_requests_updated
  BEFORE UPDATE ON public.application_info_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. File d'attente des emails transactionnels (langue du client)
CREATE TABLE IF NOT EXISTS public.transactional_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid REFERENCES public.loan_applications(id) ON DELETE CASCADE,
  to_email text NOT NULL,
  locale text NOT NULL DEFAULT 'fr',
  template text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued',
  error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transactional_emails_status ON public.transactional_emails(status, created_at DESC);

GRANT SELECT ON public.transactional_emails TO authenticated;
GRANT ALL ON public.transactional_emails TO service_role;

ALTER TABLE public.transactional_emails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read transactional emails" ON public.transactional_emails;
CREATE POLICY "Staff read transactional emails"
  ON public.transactional_emails FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP TRIGGER IF EXISTS trg_transactional_emails_updated ON public.transactional_emails;
CREATE TRIGGER trg_transactional_emails_updated
  BEFORE UPDATE ON public.transactional_emails
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Historique immuable : insertion seule, jamais modification ni suppression
CREATE OR REPLACE FUNCTION public.prevent_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'application_status_history is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_app_history_immutable ON public.application_status_history;
CREATE TRIGGER trg_app_history_immutable
  BEFORE UPDATE OR DELETE ON public.application_status_history
  FOR EACH ROW EXECUTE FUNCTION public.prevent_history_mutation();

-- 5. Raison explicite conservée sur chaque transition
ALTER TABLE public.application_status_history
  ADD COLUMN IF NOT EXISTS reason text;