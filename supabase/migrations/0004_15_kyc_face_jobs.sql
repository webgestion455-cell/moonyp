-- ---------------------------------------------------------------------------
-- 15 — File d'attente du moteur facial auto-hébergé
--
-- À appliquer avec :  bun run scripts/kyc-apply-sql.ts scripts/sql/0004_15_kyc_face_jobs.sql
-- (ou psql "$DATABASE_URL" -f scripts/sql/0004_15_kyc_face_jobs.sql)
--
-- Le moteur facial (@vladmandic/face-api + TensorFlow.js CPU) ne peut pas
-- s'exécuter dans le runtime edge qui sert l'application : il lui faut un
-- processus Node/Bun disposant de la mémoire et du temps CPU nécessaires au
-- chargement des poids (≈ 6 Mo) et au calcul des descripteurs 128D.
--
-- Les travaux faciaux sont donc mis en file ici, puis traités par le worker
-- interne `scripts/kyc-face-worker.ts`, exécuté sur l'infrastructure Moonyp.
-- Aucune image, aucun descripteur, aucune donnée biométrique ne quitte cette
-- infrastructure.
--
-- Tant qu'un travail reste `pending`, les contrôles correspondants
-- (`id_portrait_extraction`, `face_match`) restent NOT_VERIFIED : jamais PASS.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.application_kyc_face_jobs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id   UUID NOT NULL REFERENCES public.loan_applications(id) ON DELETE CASCADE,
  session_id       UUID REFERENCES public.application_kyc_sessions(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL CHECK (kind IN ('id_portrait', 'live_portrait', 'face_match')),
  step_key         TEXT NOT NULL CHECK (step_key IN ('identity', 'address', 'liveness', 'iban', 'income')),
  -- Chemins dans le bucket privé `kyc-documents` (jamais d'URL publique).
  id_portrait_path TEXT,
  live_path        TEXT,
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'running', 'done', 'error')),
  attempts         INTEGER NOT NULL DEFAULT 0,
  result           JSONB,
  error            TEXT,
  engine           TEXT,
  engine_version   TEXT,
  locked_at        TIMESTAMPTZ,
  processed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS application_kyc_face_jobs_pending_idx
  ON public.application_kyc_face_jobs (status, created_at)
  WHERE status IN ('pending', 'running');

CREATE INDEX IF NOT EXISTS application_kyc_face_jobs_application_idx
  ON public.application_kyc_face_jobs (application_id, kind);

-- Accès Data API : réservé au service_role (worker interne et fonctions
-- serveur). Ni `anon` ni `authenticated` n'atteignent cette table.
GRANT ALL ON public.application_kyc_face_jobs TO service_role;

ALTER TABLE public.application_kyc_face_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "face jobs are service only" ON public.application_kyc_face_jobs;
CREATE POLICY "face jobs are service only"
  ON public.application_kyc_face_jobs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
