-- ---------------------------------------------------------------------
-- 11 — Preuves de capture KYC (scan de document + contrôle de vivacité)
--
-- À exécuter à la suite de supabase/migrations/10, tel quel, dans l'éditeur
-- SQL Supabase du projet (ce fichier est déposé hors de supabase/migrations,
-- dossier géré par l'outillage de la plateforme : copiez-le dans vos
-- migrations locales sous le nom 11_kyc_capture_evidence.sql).
--
-- Le parcours KYC ne se contente plus d'une photo : chaque pièce scannée et
-- chaque session de vivacité produisent des mesures (cadrage, netteté,
-- luminosité, reflets, stabilité, suspicion de présentation d'écran, défis
-- de vivacité validés). Ces mesures sont revalidées côté serveur puis
-- conservées ici, afin que la conformité dispose d'une piste d'audit réelle.
--
-- Aucune donnée existante n'est modifiée : les colonnes sont ajoutées avec
-- des valeurs nulles et les dossiers déjà déposés restent inchangés.
-- ---------------------------------------------------------------------

-- 1. Preuve attachée à la pièce déposée --------------------------------------
ALTER TABLE public.application_documents
  ADD COLUMN IF NOT EXISTS capture_method   TEXT,
  ADD COLUMN IF NOT EXISTS capture_evidence JSONB;

ALTER TABLE public.application_documents
  DROP CONSTRAINT IF EXISTS application_documents_capture_method_check;
ALTER TABLE public.application_documents
  ADD CONSTRAINT application_documents_capture_method_check
  CHECK (capture_method IS NULL OR capture_method IN ('scan', 'upload', 'liveness'));

COMMENT ON COLUMN public.application_documents.capture_method IS
  'Origine réelle de la pièce : scan caméra, import de fichier ou contrôle de vivacité.';
COMMENT ON COLUMN public.application_documents.capture_evidence IS
  'Preuve de capture normalisée et revalidée côté serveur (mesures image ou session de vivacité).';

-- 2. Trace de contrôle enrichie ----------------------------------------------
ALTER TABLE public.application_kyc_checks
  ADD COLUMN IF NOT EXISTS method   TEXT,
  ADD COLUMN IF NOT EXISTS evidence JSONB,
  ADD COLUMN IF NOT EXISTS reasons  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE public.application_kyc_checks
  DROP CONSTRAINT IF EXISTS application_kyc_checks_method_check;
ALTER TABLE public.application_kyc_checks
  ADD CONSTRAINT application_kyc_checks_method_check
  CHECK (method IS NULL OR method IN ('scan', 'upload', 'liveness'));

COMMENT ON COLUMN public.application_kyc_checks.method IS
  'Mode de capture ayant produit le contrôle.';
COMMENT ON COLUMN public.application_kyc_checks.evidence IS
  'Preuve revalidée côté serveur (mêmes mesures que application_documents.capture_evidence).';
COMMENT ON COLUMN public.application_kyc_checks.reasons IS
  'Motifs machine relevés lors de la revalidation serveur (vide = aucune anomalie).';

-- 3. Consultation back-office -------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_kyc_checks_method
  ON public.application_kyc_checks(method);
CREATE INDEX IF NOT EXISTS idx_kyc_checks_status_app
  ON public.application_kyc_checks(application_id, status);

-- 4. Droits — inchangés, rappelés ici pour que la migration soit autoportante --
GRANT SELECT, UPDATE ON public.application_documents TO authenticated;
GRANT ALL ON public.application_documents TO service_role;
GRANT SELECT, UPDATE ON public.application_kyc_checks TO authenticated;
GRANT ALL ON public.application_kyc_checks TO service_role;
