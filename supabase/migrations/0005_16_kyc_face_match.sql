-- ---------------------------------------------------------------------
-- 16 — Correspondance faciale pièce d'identité <-> contrôle de vivacité
--
-- À exécuter après 0004_15_kyc_face_jobs.sql (script: bun scripts/kyc-apply-sql.ts
-- ou éditeur SQL Supabase). Aucune suppression, aucune modification de
-- l'existant : seules des colonnes sont ajoutées à la table de décision.
-- Les dossiers déjà décidés restent inchangés (NULL = comparaison non
-- effectuée à l'époque).
-- ---------------------------------------------------------------------

-- 1. Résultat de la comparaison conservé avec la décision --------------------
ALTER TABLE public.application_identity_decisions
  ADD COLUMN IF NOT EXISTS face_match            JSONB,
  ADD COLUMN IF NOT EXISTS face_match_status     TEXT,
  ADD COLUMN IF NOT EXISTS face_similarity       NUMERIC(6,4),
  ADD COLUMN IF NOT EXISTS face_threshold        NUMERIC(6,4),
  ADD COLUMN IF NOT EXISTS face_engine           TEXT,
  ADD COLUMN IF NOT EXISTS face_engine_version   TEXT,
  ADD COLUMN IF NOT EXISTS thresholds            JSONB,
  ADD COLUMN IF NOT EXISTS decided_by            TEXT NOT NULL DEFAULT 'server';

COMMENT ON COLUMN public.application_identity_decisions.face_match IS
  'Resultat non biometrique de la comparaison visage piece <-> visage vivant : compared, similarity, threshold, passed, band, motifs, qualite. Aucun descripteur biometrique stocke.';
COMMENT ON COLUMN public.application_identity_decisions.face_match_status IS
  'Bande de decision de la comparaison faciale : match | borderline | mismatch | not_compared.';
COMMENT ON COLUMN public.application_identity_decisions.face_similarity IS
  'Similarite 0..1 calculee par le moteur serveur reellement utilise.';
COMMENT ON COLUMN public.application_identity_decisions.face_threshold IS
  'Seuil serveur applique a cette decision, fige au moment du calcul.';
COMMENT ON COLUMN public.application_identity_decisions.face_engine IS
  'Moteur de comparaison utilise (moonyp-face-classic, ou face-api resnet34 128D du worker interne).';
COMMENT ON COLUMN public.application_identity_decisions.face_engine_version IS
  'Version du moteur, conservee pour la reproductibilite de l audit.';
COMMENT ON COLUMN public.application_identity_decisions.thresholds IS
  'Jeu de seuils serveur applique (version + valeurs), pour rejouer la decision a l identique.';
COMMENT ON COLUMN public.application_identity_decisions.decided_by IS
  'Origine de la decision : toujours "server". Aucune decision client n est acceptee.';

-- 2. Coherence de la bande de decision ---------------------------------------
ALTER TABLE public.application_identity_decisions
  DROP CONSTRAINT IF EXISTS application_identity_decisions_face_status_check;
ALTER TABLE public.application_identity_decisions
  ADD CONSTRAINT application_identity_decisions_face_status_check
  CHECK (
    face_match_status IS NULL
    OR face_match_status IN ('match', 'borderline', 'mismatch', 'not_compared')
  );

-- 3. Recherche back-office ----------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_identity_decisions_face_status
  ON public.application_identity_decisions(face_match_status);

-- 4. Droits Data API ----------------------------------------------------------
-- Inchanges : la table conserve ses GRANT et ses politiques RLS d origine.
GRANT SELECT, UPDATE ON public.application_identity_decisions TO authenticated;
GRANT ALL ON public.application_identity_decisions TO service_role;
