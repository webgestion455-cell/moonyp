-- =====================================================================
-- MOONYP — 05. Dossiers de demande : référence CR-AAAA-NNNNNN,
--              documents KYC, historique, évènements, OTP,
--              jetons d'accès sécurisés (portail sans compte).
-- =====================================================================

CREATE SEQUENCE IF NOT EXISTS public.loan_application_ref_seq START 1;

-- ---------------------------------------------------------------------
-- loan_applications
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.loan_applications (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference          TEXT NOT NULL UNIQUE,
  status             public.application_status NOT NULL DEFAULT 'draft',
  language           TEXT NOT NULL DEFAULT 'en',
  product_id         UUID REFERENCES public.loan_products(id) ON DELETE SET NULL,

  -- Étape 1 : identité
  first_name         TEXT,
  last_name          TEXT,
  birth_date         DATE,
  nationality        TEXT,
  address            TEXT,
  postal_code        TEXT,
  city               TEXT,
  country            TEXT,
  phone              TEXT,
  email              TEXT,

  -- Étape 2 : situation professionnelle et financière
  employment_status  TEXT,
  profession         TEXT,
  employer           TEXT,
  seniority_months   INTEGER,
  monthly_income     NUMERIC(12,2),
  monthly_charges    NUMERIC(12,2),
  other_income       NUMERIC(12,2),
  household_size     INTEGER,

  -- Étape 3 : demande
  amount             NUMERIC(14,2),
  duration_months    INTEGER,
  purpose            TEXT,
  insurance_opted    BOOLEAN NOT NULL DEFAULT false,

  -- Étape 4 : coordonnées de versement
  bank_holder        TEXT,
  bank_name          TEXT,
  bank_iban          TEXT,
  bank_bic           TEXT,

  -- Consentements
  consent_terms      BOOLEAN NOT NULL DEFAULT false,
  consent_privacy    BOOLEAN NOT NULL DEFAULT false,
  consent_marketing  BOOLEAN NOT NULL DEFAULT false,

  current_step       INTEGER NOT NULL DEFAULT 1,
  admin_notes        TEXT,
  rejection_reason   TEXT,
  submitted_at       TIMESTAMPTZ,
  decided_at         TIMESTAMPTZ,
  created_ip         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_applications_status ON public.loan_applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_created ON public.loan_applications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_applications_email ON public.loan_applications(lower(email));

-- Création et lecture publiques passent par des server functions (service_role).
GRANT SELECT, UPDATE ON public.loan_applications TO authenticated;
GRANT ALL ON public.loan_applications TO service_role;
ALTER TABLE public.loan_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "applications_read_staff" ON public.loan_applications;
CREATE POLICY "applications_read_staff" ON public.loan_applications
  FOR SELECT TO authenticated USING (public.has_permission(auth.uid(), 'applications.view'));

DROP POLICY IF EXISTS "applications_update_staff" ON public.loan_applications;
CREATE POLICY "applications_update_staff" ON public.loan_applications
  FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(), 'applications.review'))
  WITH CHECK (public.has_permission(auth.uid(), 'applications.review'));

DROP TRIGGER IF EXISTS trg_loan_applications_updated ON public.loan_applications;
CREATE TRIGGER trg_loan_applications_updated
  BEFORE UPDATE ON public.loan_applications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Référence automatique CR-AAAA-NNNNNN
CREATE OR REPLACE FUNCTION public.set_application_reference()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.reference IS NULL OR NEW.reference = '' THEN
    NEW.reference := 'CR-' || to_char(now(), 'YYYY') || '-' ||
      lpad(nextval('public.loan_application_ref_seq')::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_application_reference ON public.loan_applications;
CREATE TRIGGER trg_application_reference
  BEFORE INSERT ON public.loan_applications
  FOR EACH ROW EXECUTE FUNCTION public.set_application_reference();

-- ---------------------------------------------------------------------
-- Historique de statut
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.application_status_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  UUID NOT NULL REFERENCES public.loan_applications(id) ON DELETE CASCADE,
  old_status      public.application_status,
  new_status      public.application_status NOT NULL,
  changed_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor           TEXT NOT NULL DEFAULT 'system',  -- applicant | staff | system
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_app_status_history_app ON public.application_status_history(application_id, created_at DESC);

GRANT SELECT ON public.application_status_history TO authenticated;
GRANT ALL ON public.application_status_history TO service_role;
ALTER TABLE public.application_status_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_status_history_read_staff" ON public.application_status_history;
CREATE POLICY "app_status_history_read_staff" ON public.application_status_history
  FOR SELECT TO authenticated USING (public.has_permission(auth.uid(), 'applications.view'));

-- Ordre du workflow : permet de purger l'historique en cas de régression
-- (un retour en arrière ne doit jamais "faire avancer" la chronologie).
CREATE OR REPLACE FUNCTION public.application_status_order(_s public.application_status)
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _s
    WHEN 'draft'                  THEN 0
    WHEN 'received'               THEN 1
    WHEN 'verification'           THEN 2
    WHEN 'documents_missing'      THEN 2
    WHEN 'analysis'               THEN 3
    WHEN 'info_requested'         THEN 3
    WHEN 'approved'               THEN 4
    WHEN 'offer_available'        THEN 5
    WHEN 'contract_sent'          THEN 6
    WHEN 'signature_pending'      THEN 7
    WHEN 'contract_signed'        THEN 8
    WHEN 'disbursement_preparing' THEN 9
    WHEN 'disbursed'              THEN 10
    WHEN 'repaying'               THEN 11
    WHEN 'late'                   THEN 11
    WHEN 'repaid'                 THEN 12
    WHEN 'rejected'               THEN 99
    WHEN 'cancelled'              THEN 99
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION public.log_application_status()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_ord INTEGER;
  old_ord INTEGER;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.application_status_history (application_id, old_status, new_status, changed_by, actor)
    VALUES (NEW.id, NULL, NEW.status, auth.uid(),
            CASE WHEN auth.uid() IS NULL THEN 'applicant' ELSE 'staff' END);
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    new_ord := public.application_status_order(NEW.status);
    old_ord := public.application_status_order(OLD.status);

    IF new_ord < old_ord THEN
      -- Régression : on supprime les évènements postérieurs au nouvel état.
      DELETE FROM public.application_status_history
       WHERE application_id = NEW.id
         AND public.application_status_order(new_status) > new_ord;
    ELSE
      INSERT INTO public.application_status_history (application_id, old_status, new_status, changed_by, actor, note)
      VALUES (NEW.id, OLD.status, NEW.status, auth.uid(),
              CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'staff' END, NEW.admin_notes);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_application_status_history_ins ON public.loan_applications;
CREATE TRIGGER trg_application_status_history_ins
  AFTER INSERT ON public.loan_applications
  FOR EACH ROW EXECUTE FUNCTION public.log_application_status();

DROP TRIGGER IF EXISTS trg_application_status_history_upd ON public.loan_applications;
CREATE TRIGGER trg_application_status_history_upd
  AFTER UPDATE ON public.loan_applications
  FOR EACH ROW EXECUTE FUNCTION public.log_application_status();

-- ---------------------------------------------------------------------
-- Documents KYC
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.application_documents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id      UUID NOT NULL REFERENCES public.loan_applications(id) ON DELETE CASCADE,
  document_type_slug  TEXT NOT NULL,
  storage_path        TEXT NOT NULL,
  file_name           TEXT NOT NULL,
  mime_type           TEXT,
  file_size           INTEGER,
  status              public.document_review_status NOT NULL DEFAULT 'pending',
  review_note         TEXT,
  reviewed_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_app_documents_app ON public.application_documents(application_id);

GRANT SELECT, UPDATE ON public.application_documents TO authenticated;
GRANT ALL ON public.application_documents TO service_role;
ALTER TABLE public.application_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_documents_read_staff" ON public.application_documents;
CREATE POLICY "app_documents_read_staff" ON public.application_documents
  FOR SELECT TO authenticated USING (public.has_permission(auth.uid(), 'applications.view'));

DROP POLICY IF EXISTS "app_documents_review_staff" ON public.application_documents;
CREATE POLICY "app_documents_review_staff" ON public.application_documents
  FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(), 'documents.review'))
  WITH CHECK (public.has_permission(auth.uid(), 'documents.review'));

DROP TRIGGER IF EXISTS trg_app_documents_updated ON public.application_documents;
CREATE TRIGGER trg_app_documents_updated
  BEFORE UPDATE ON public.application_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- Évènements (piste d'audit du dossier)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.application_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  UUID NOT NULL REFERENCES public.loan_applications(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL,
  actor           TEXT NOT NULL DEFAULT 'system',
  actor_id        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  description     TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip              TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_app_events_app ON public.application_events(application_id, created_at DESC);

GRANT SELECT ON public.application_events TO authenticated;
GRANT ALL ON public.application_events TO service_role;
ALTER TABLE public.application_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_events_read_staff" ON public.application_events;
CREATE POLICY "app_events_read_staff" ON public.application_events
  FOR SELECT TO authenticated USING (public.has_permission(auth.uid(), 'applications.view'));

-- ---------------------------------------------------------------------
-- Jetons d'accès au portail sécurisé (hachés)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.application_access_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  UUID NOT NULL REFERENCES public.loan_applications(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL UNIQUE,
  purpose         TEXT NOT NULL DEFAULT 'portal',
  expires_at      TIMESTAMPTZ,
  revoked         BOOLEAN NOT NULL DEFAULT false,
  last_used_at    TIMESTAMPTZ,
  use_count       INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_app_tokens_app ON public.application_access_tokens(application_id);

-- Jamais exposé au client : uniquement service_role.
GRANT SELECT ON public.application_access_tokens TO authenticated;
GRANT ALL ON public.application_access_tokens TO service_role;
ALTER TABLE public.application_access_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_tokens_read_staff" ON public.application_access_tokens;
CREATE POLICY "app_tokens_read_staff" ON public.application_access_tokens
  FOR SELECT TO authenticated USING (public.has_permission(auth.uid(), 'applications.view'));

-- ---------------------------------------------------------------------
-- Codes OTP du portail (signature, accès renforcé)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.application_otp_codes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  UUID NOT NULL REFERENCES public.loan_applications(id) ON DELETE CASCADE,
  code_hash       TEXT NOT NULL,
  purpose         TEXT NOT NULL DEFAULT 'signature',
  attempts        INTEGER NOT NULL DEFAULT 0,
  used            BOOLEAN NOT NULL DEFAULT false,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_app_otp_app ON public.application_otp_codes(application_id);

-- Aucun accès client : service_role seulement.
GRANT ALL ON public.application_otp_codes TO service_role;
ALTER TABLE public.application_otp_codes ENABLE ROW LEVEL SECURITY;
