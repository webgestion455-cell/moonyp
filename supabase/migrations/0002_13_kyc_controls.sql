-- =====================================================================
-- 13 — Moteur KYC interne : sessions, étapes, contrôles, biométrie,
--      journal d'audit immuable, listes de filtrage versionnées.
--
-- Principes :
--   * Les tables existantes sont RÉUTILISÉES (loan_applications,
--     application_documents, application_kyc_checks, application_events,
--     application_identity_decisions). Rien n'est dupliqué : cette
--     migration ajoute la granularité « un contrôle = une ligne » qui
--     manquait, et le journal d'audit append-only.
--   * Un contrôle non exécuté n'est jamais PASS : le statut par défaut est
--     NOT_STARTED, et la colonne `executed` distingue un contrôle réellement
--     lancé d'un contrôle déclaré non vérifiable (NOT_VERIFIED).
--   * Aucune donnée biométrique brute (descripteur facial, image) n'est
--     stockée en base : seules des références Storage (bucket privé) et des
--     empreintes SHA-256 y figurent, avec une date d'expiration.
-- =====================================================================

ALTER TABLE public.application_documents
  ADD COLUMN IF NOT EXISTS sha256          TEXT,
  ADD COLUMN IF NOT EXISTS detected_mime   TEXT,
  ADD COLUMN IF NOT EXISTS server_analysis JSONB;

CREATE INDEX IF NOT EXISTS idx_app_documents_sha256
  ON public.application_documents(sha256) WHERE sha256 IS NOT NULL;

ALTER TABLE public.loan_applications
  ADD COLUMN IF NOT EXISTS kyc_state TEXT NOT NULL DEFAULT 'kyc_not_started',
  ADD COLUMN IF NOT EXISTS kyc_state_updated_at TIMESTAMPTZ;

ALTER TABLE public.loan_applications DROP CONSTRAINT IF EXISTS loan_applications_kyc_state_check;
ALTER TABLE public.loan_applications ADD CONSTRAINT loan_applications_kyc_state_check CHECK (
  kyc_state IN (
    'kyc_not_started',
    'kyc_in_progress',
    'kyc_ready_for_review',
    'kyc_review_required',
    'kyc_insufficient_evidence',
    'kyc_rejected_evidence'
  )
);

CREATE TABLE IF NOT EXISTS public.application_kyc_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  UUID NOT NULL REFERENCES public.loan_applications(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'in_progress'
                  CHECK (status IN ('in_progress', 'completed', 'abandoned')),
  engine_version  TEXT NOT NULL,
  language        TEXT,
  current_step    TEXT CHECK (current_step IN ('identity', 'address', 'liveness', 'iban', 'income')),
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kyc_sessions_app ON public.application_kyc_sessions(application_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_kyc_sessions_open
  ON public.application_kyc_sessions(application_id) WHERE status = 'in_progress';

GRANT SELECT ON public.application_kyc_sessions TO authenticated;
GRANT ALL ON public.application_kyc_sessions TO service_role;
ALTER TABLE public.application_kyc_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kyc_sessions_read_staff" ON public.application_kyc_sessions;
CREATE POLICY "kyc_sessions_read_staff" ON public.application_kyc_sessions
  FOR SELECT TO authenticated USING (public.has_permission(auth.uid(), 'applications.view'));

DROP TRIGGER IF EXISTS trg_kyc_sessions_updated ON public.application_kyc_sessions;
CREATE TRIGGER trg_kyc_sessions_updated
  BEFORE UPDATE ON public.application_kyc_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.application_kyc_steps (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES public.application_kyc_sessions(id) ON DELETE CASCADE,
  application_id  UUID NOT NULL REFERENCES public.loan_applications(id) ON DELETE CASCADE,
  step_key        TEXT NOT NULL CHECK (step_key IN ('identity', 'address', 'liveness', 'iban', 'income')),
  attempt         INTEGER NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  status          TEXT NOT NULL DEFAULT 'NOT_STARTED'
                  CHECK (status IN ('NOT_STARTED', 'PASS', 'FAIL', 'REVIEW_REQUIRED', 'INCONCLUSIVE')),
  reasons         TEXT[] NOT NULL DEFAULT '{}',
  document_ids    UUID[] NOT NULL DEFAULT '{}',
  document_type_slug TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  duration_ms     INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, step_key, attempt)
);
CREATE INDEX IF NOT EXISTS idx_kyc_steps_app ON public.application_kyc_steps(application_id, step_key);

GRANT SELECT ON public.application_kyc_steps TO authenticated;
GRANT ALL ON public.application_kyc_steps TO service_role;
ALTER TABLE public.application_kyc_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kyc_steps_read_staff" ON public.application_kyc_steps;
CREATE POLICY "kyc_steps_read_staff" ON public.application_kyc_steps
  FOR SELECT TO authenticated USING (public.has_permission(auth.uid(), 'applications.view'));

DROP TRIGGER IF EXISTS trg_kyc_steps_updated ON public.application_kyc_steps;
CREATE TRIGGER trg_kyc_steps_updated
  BEFORE UPDATE ON public.application_kyc_steps
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.application_kyc_controls (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES public.application_kyc_sessions(id) ON DELETE CASCADE,
  step_id         UUID REFERENCES public.application_kyc_steps(id) ON DELETE CASCADE,
  application_id  UUID NOT NULL REFERENCES public.loan_applications(id) ON DELETE CASCADE,
  step_key        TEXT NOT NULL CHECK (step_key IN ('identity', 'address', 'liveness', 'iban', 'income')),
  control_key     TEXT NOT NULL,
  attempt         INTEGER NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  status          TEXT NOT NULL DEFAULT 'NOT_STARTED'
                  CHECK (status IN ('PASS', 'FAIL', 'REVIEW_REQUIRED', 'INCONCLUSIVE', 'NOT_VERIFIED', 'NOT_STARTED')),
  executed        BOOLEAN NOT NULL DEFAULT false,
  method          TEXT,
  library         TEXT,
  library_version TEXT,
  engine_version  TEXT NOT NULL,
  score           NUMERIC(10,4),
  threshold       NUMERIC(10,4),
  reasons         TEXT[] NOT NULL DEFAULT '{}',
  details         JSONB NOT NULL DEFAULT '{}'::jsonb,
  document_id     UUID REFERENCES public.application_documents(id) ON DELETE SET NULL,
  duration_ms     INTEGER,
  review_status   TEXT CHECK (review_status IN ('PASS', 'FAIL', 'REVIEW_REQUIRED')),
  review_note     TEXT,
  reviewed_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, control_key, attempt),
  CONSTRAINT kyc_controls_pass_requires_execution CHECK (status <> 'PASS' OR executed = true)
);
CREATE INDEX IF NOT EXISTS idx_kyc_controls_app ON public.application_kyc_controls(application_id, step_key);
CREATE INDEX IF NOT EXISTS idx_kyc_controls_status ON public.application_kyc_controls(status);

GRANT SELECT, UPDATE ON public.application_kyc_controls TO authenticated;
GRANT ALL ON public.application_kyc_controls TO service_role;
ALTER TABLE public.application_kyc_controls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kyc_controls_read_staff" ON public.application_kyc_controls;
CREATE POLICY "kyc_controls_read_staff" ON public.application_kyc_controls
  FOR SELECT TO authenticated USING (public.has_permission(auth.uid(), 'applications.view'));

DROP POLICY IF EXISTS "kyc_controls_review_staff" ON public.application_kyc_controls;
CREATE POLICY "kyc_controls_review_staff" ON public.application_kyc_controls
  FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(), 'kyc.review'))
  WITH CHECK (public.has_permission(auth.uid(), 'kyc.review'));

DROP TRIGGER IF EXISTS trg_kyc_controls_updated ON public.application_kyc_controls;
CREATE TRIGGER trg_kyc_controls_updated
  BEFORE UPDATE ON public.application_kyc_controls
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.kyc_controls_freeze_machine_result()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.executed IS DISTINCT FROM OLD.executed
     OR NEW.method IS DISTINCT FROM OLD.method
     OR NEW.library IS DISTINCT FROM OLD.library
     OR NEW.library_version IS DISTINCT FROM OLD.library_version
     OR NEW.engine_version IS DISTINCT FROM OLD.engine_version
     OR NEW.score IS DISTINCT FROM OLD.score
     OR NEW.threshold IS DISTINCT FROM OLD.threshold
     OR NEW.reasons IS DISTINCT FROM OLD.reasons
     OR NEW.details IS DISTINCT FROM OLD.details
     OR NEW.document_id IS DISTINCT FROM OLD.document_id
     OR NEW.control_key IS DISTINCT FROM OLD.control_key
     OR NEW.step_key IS DISTINCT FROM OLD.step_key
     OR NEW.attempt IS DISTINCT FROM OLD.attempt THEN
    RAISE EXCEPTION 'kyc_control_machine_result_is_immutable';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_kyc_controls_freeze ON public.application_kyc_controls;
CREATE TRIGGER trg_kyc_controls_freeze
  BEFORE UPDATE ON public.application_kyc_controls
  FOR EACH ROW EXECUTE FUNCTION public.kyc_controls_freeze_machine_result();

CREATE TABLE IF NOT EXISTS public.application_kyc_biometric_assets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  UUID NOT NULL REFERENCES public.loan_applications(id) ON DELETE CASCADE,
  session_id      UUID REFERENCES public.application_kyc_sessions(id) ON DELETE SET NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('id_portrait', 'liveness_portrait', 'challenge_frame')),
  challenge       TEXT,
  storage_path    TEXT NOT NULL,
  sha256          TEXT,
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '90 days'),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kyc_biometric_app ON public.application_kyc_biometric_assets(application_id);
CREATE INDEX IF NOT EXISTS idx_kyc_biometric_expiry ON public.application_kyc_biometric_assets(expires_at);

GRANT SELECT ON public.application_kyc_biometric_assets TO authenticated;
GRANT ALL ON public.application_kyc_biometric_assets TO service_role;
ALTER TABLE public.application_kyc_biometric_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kyc_biometric_read_staff" ON public.application_kyc_biometric_assets;
CREATE POLICY "kyc_biometric_read_staff" ON public.application_kyc_biometric_assets
  FOR SELECT TO authenticated USING (public.has_permission(auth.uid(), 'kyc.review'));

CREATE TABLE IF NOT EXISTS public.application_kyc_audit_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  UUID NOT NULL REFERENCES public.loan_applications(id) ON DELETE CASCADE,
  session_id      UUID REFERENCES public.application_kyc_sessions(id) ON DELETE SET NULL,
  event_type      TEXT NOT NULL,
  step_key        TEXT,
  control_key     TEXT,
  status          TEXT,
  actor_type      TEXT NOT NULL DEFAULT 'system' CHECK (actor_type IN ('applicant', 'system', 'staff')),
  actor_id        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  engine_version  TEXT,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kyc_audit_app ON public.application_kyc_audit_events(application_id, created_at DESC);

GRANT SELECT ON public.application_kyc_audit_events TO authenticated;
GRANT SELECT, INSERT ON public.application_kyc_audit_events TO service_role;
ALTER TABLE public.application_kyc_audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kyc_audit_read_staff" ON public.application_kyc_audit_events;
CREATE POLICY "kyc_audit_read_staff" ON public.application_kyc_audit_events
  FOR SELECT TO authenticated USING (public.has_permission(auth.uid(), 'applications.view'));

CREATE OR REPLACE FUNCTION public.kyc_audit_events_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'kyc_audit_events_are_immutable';
END $$;

DROP TRIGGER IF EXISTS trg_kyc_audit_no_update ON public.application_kyc_audit_events;
CREATE TRIGGER trg_kyc_audit_no_update
  BEFORE UPDATE OR DELETE ON public.application_kyc_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.kyc_audit_events_immutable();

CREATE TABLE IF NOT EXISTS public.kyc_screening_lists (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source          TEXT NOT NULL,
  list_kind       TEXT NOT NULL DEFAULT 'sanctions' CHECK (list_kind IN ('sanctions', 'pep')),
  list_name       TEXT NOT NULL,
  version         TEXT NOT NULL,
  sha256          TEXT NOT NULL,
  entry_count     INTEGER NOT NULL DEFAULT 0,
  format          TEXT,
  imported_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  imported_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  active          BOOLEAN NOT NULL DEFAULT true,
  notes           TEXT,
  UNIQUE (source, sha256)
);
CREATE INDEX IF NOT EXISTS idx_kyc_screening_lists_active ON public.kyc_screening_lists(active, list_kind);

GRANT SELECT ON public.kyc_screening_lists TO authenticated;
GRANT ALL ON public.kyc_screening_lists TO service_role;
ALTER TABLE public.kyc_screening_lists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kyc_screening_lists_read_staff" ON public.kyc_screening_lists;
CREATE POLICY "kyc_screening_lists_read_staff" ON public.kyc_screening_lists
  FOR SELECT TO authenticated USING (public.has_permission(auth.uid(), 'kyc.review'));

CREATE TABLE IF NOT EXISTS public.kyc_screening_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id         UUID NOT NULL REFERENCES public.kyc_screening_lists(id) ON DELETE CASCADE,
  external_id     TEXT,
  entry_type      TEXT NOT NULL DEFAULT 'person' CHECK (entry_type IN ('person', 'entity', 'unknown')),
  primary_name    TEXT NOT NULL,
  names           TEXT[] NOT NULL DEFAULT '{}',
  birth_dates     TEXT[] NOT NULL DEFAULT '{}',
  nationalities   TEXT[] NOT NULL DEFAULT '{}',
  programs        TEXT[] NOT NULL DEFAULT '{}',
  raw             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kyc_screening_entries_list ON public.kyc_screening_entries(list_id);
CREATE INDEX IF NOT EXISTS idx_kyc_screening_entries_names ON public.kyc_screening_entries USING GIN (names);

GRANT SELECT ON public.kyc_screening_entries TO authenticated;
GRANT ALL ON public.kyc_screening_entries TO service_role;
ALTER TABLE public.kyc_screening_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kyc_screening_entries_read_staff" ON public.kyc_screening_entries;
CREATE POLICY "kyc_screening_entries_read_staff" ON public.kyc_screening_entries
  FOR SELECT TO authenticated USING (public.has_permission(auth.uid(), 'kyc.review'));

CREATE OR REPLACE FUNCTION public.kyc_screening_candidates(_tokens TEXT[], _limit INTEGER DEFAULT 200)
RETURNS SETOF public.kyc_screening_entries
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.*
  FROM public.kyc_screening_entries e
  JOIN public.kyc_screening_lists l ON l.id = e.list_id AND l.active
  WHERE EXISTS (
    SELECT 1 FROM unnest(e.names) n, unnest(_tokens) t
    WHERE n LIKE '%' || t || '%'
  )
  LIMIT GREATEST(1, LEAST(_limit, 1000));
$$;
REVOKE ALL ON FUNCTION public.kyc_screening_candidates(TEXT[], INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kyc_screening_candidates(TEXT[], INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.kyc_expired_biometric_assets(_limit INTEGER DEFAULT 500)
RETURNS TABLE (id UUID, storage_path TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id, a.storage_path
  FROM public.application_kyc_biometric_assets a
  WHERE a.expires_at < now()
  ORDER BY a.expires_at
  LIMIT GREATEST(1, LEAST(_limit, 5000));
$$;
REVOKE ALL ON FUNCTION public.kyc_expired_biometric_assets(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kyc_expired_biometric_assets(INTEGER) TO service_role;