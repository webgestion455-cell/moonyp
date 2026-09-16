-- ---------------------------------------------------------------------
-- 12 — Décision KYC automatisée (OCR / MRZ, croisement, arbitrage)
--
-- À exécuter après supabase/migrations/11, tel quel, dans l'éditeur SQL du
-- projet Supabase. En local, copiez ce fichier sous
-- supabase/migrations/12_kyc_ocr_decision.sql.
--
-- Le parcours d'identité ne produit plus seulement des pièces et des mesures
-- de capture : la bande MRZ est lue, ses clés de contrôle vérifiées, les
-- données lues sont croisées avec l'identité déclarée, et une décision
-- bancaire explicite est rendue (passed / manual_review / failed).
--
-- Rien d'existant n'est modifié ni supprimé : deux colonnes sont ajoutées à
-- application_documents, une table de décision est créée, trois colonnes sont
-- ajoutées au dossier. Les dossiers déjà déposés restent inchangés.
-- ---------------------------------------------------------------------

-- 1. Lecture OCR/MRZ conservée avec la pièce ---------------------------------
ALTER TABLE public.application_documents
  ADD COLUMN IF NOT EXISTS ocr_mrz        JSONB,
  ADD COLUMN IF NOT EXISTS ocr_confidence NUMERIC(5,2);

COMMENT ON COLUMN public.application_documents.ocr_mrz IS
  'MRZ décodée et revérifiée côté serveur (champs, clés de contrôle, lignes masquées).';
COMMENT ON COLUMN public.application_documents.ocr_confidence IS
  'Confiance moyenne du moteur OCR sur la bande MRZ (0..100).';

-- 2. Décision d'identité ------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.application_identity_decisions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id     UUID NOT NULL REFERENCES public.loan_applications(id) ON DELETE CASCADE,
  decision           TEXT NOT NULL,                      -- passed | manual_review | failed
  score              NUMERIC(6,2),
  reasons            TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  -- Comparaison champ par champ (déclaré vs lu) et métadonnées OCR.
  identity_match     JSONB,
  mrz                JSONB,
  source_document    TEXT,
  ocr_confidence     NUMERIC(5,2),
  engine             TEXT,
  reviewed_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at        TIMESTAMPTZ,
  review_note        TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.application_identity_decisions
  DROP CONSTRAINT IF EXISTS application_identity_decisions_decision_check;
ALTER TABLE public.application_identity_decisions
  ADD CONSTRAINT application_identity_decisions_decision_check
  CHECK (decision IN ('passed', 'manual_review', 'failed'));

CREATE INDEX IF NOT EXISTS idx_identity_decisions_app
  ON public.application_identity_decisions(application_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_identity_decisions_decision
  ON public.application_identity_decisions(decision);

-- 3. Droits Data API ----------------------------------------------------------
GRANT SELECT, UPDATE ON public.application_identity_decisions TO authenticated;
GRANT ALL ON public.application_identity_decisions TO service_role;

-- 4. RLS — lecture par le back-office autorisé, revue par la conformité -------
ALTER TABLE public.application_identity_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "identity_decisions_read_staff" ON public.application_identity_decisions;
CREATE POLICY "identity_decisions_read_staff" ON public.application_identity_decisions
  FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'applications.view'));

DROP POLICY IF EXISTS "identity_decisions_review_staff" ON public.application_identity_decisions;
CREATE POLICY "identity_decisions_review_staff" ON public.application_identity_decisions
  FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(), 'kyc.review'))
  WITH CHECK (public.has_permission(auth.uid(), 'kyc.review'));

DROP TRIGGER IF EXISTS trg_identity_decisions_updated ON public.application_identity_decisions;
CREATE TRIGGER trg_identity_decisions_updated
  BEFORE UPDATE ON public.application_identity_decisions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. Report de la décision sur le dossier -------------------------------------
ALTER TABLE public.loan_applications
  ADD COLUMN IF NOT EXISTS kyc_decision        TEXT,
  ADD COLUMN IF NOT EXISTS kyc_decision_score  NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS kyc_decided_at      TIMESTAMPTZ;

ALTER TABLE public.loan_applications
  DROP CONSTRAINT IF EXISTS loan_applications_kyc_decision_check;
ALTER TABLE public.loan_applications
  ADD CONSTRAINT loan_applications_kyc_decision_check
  CHECK (kyc_decision IS NULL OR kyc_decision IN ('passed', 'manual_review', 'failed'));

COMMENT ON COLUMN public.loan_applications.kyc_decision IS
  'Décision KYC automatique la plus récente (OCR/MRZ + croisement + vivacité).';

CREATE INDEX IF NOT EXISTS idx_loan_applications_kyc_decision
  ON public.loan_applications(kyc_decision);
