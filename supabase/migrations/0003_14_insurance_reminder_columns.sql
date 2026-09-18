-- 14 — Colonnes de relance assurance manquantes.
-- src/routes/api/public/guarantee-reminders.ts écrit déjà reminder_count et
-- reminder_last_sent_at sur application_insurances (via un cast qui masquait
-- l'écart de schéma). Cette migration aligne la base sur le code.
ALTER TABLE public.application_insurances
  ADD COLUMN IF NOT EXISTS reminder_count        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reminder_last_sent_at TIMESTAMPTZ;