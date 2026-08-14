-- =====================================================================
-- MOONYP — 03. Sécurité : journal des évènements, appareils de confiance,
--              alertes et scoring comportemental.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.security_logs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action              TEXT NOT NULL,
  success             BOOLEAN NOT NULL DEFAULT true,
  device_fingerprint  TEXT,
  browser             TEXT,
  os                  TEXT,
  user_agent          TEXT,
  ip_address          TEXT,
  country             TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_security_logs_created ON public.security_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_logs_user ON public.security_logs(user_id);

GRANT SELECT, INSERT ON public.security_logs TO authenticated;
GRANT INSERT ON public.security_logs TO anon;
GRANT ALL ON public.security_logs TO service_role;
ALTER TABLE public.security_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "security_logs_insert_any" ON public.security_logs;
CREATE POLICY "security_logs_insert_any" ON public.security_logs
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "security_logs_read" ON public.security_logs;
CREATE POLICY "security_logs_read" ON public.security_logs
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_permission(auth.uid(), 'security.view'));

-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trusted_devices (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fingerprint   TEXT NOT NULL,
  label         TEXT,
  browser       TEXT,
  os            TEXT,
  ip_address    TEXT,
  country       TEXT,
  trusted       BOOLEAN NOT NULL DEFAULT false,
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_user ON public.trusted_devices(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trusted_devices TO authenticated;
GRANT ALL ON public.trusted_devices TO service_role;
ALTER TABLE public.trusted_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "trusted_devices_own" ON public.trusted_devices;
CREATE POLICY "trusted_devices_own" ON public.trusted_devices
  FOR ALL TO authenticated
  USING (auth.uid() = user_id OR public.has_permission(auth.uid(), 'security.view'))
  WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.security_alerts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  alert_type   TEXT NOT NULL,
  severity     TEXT NOT NULL DEFAULT 'low',
  description  TEXT,
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolved     BOOLEAN NOT NULL DEFAULT false,
  resolved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_security_alerts_created ON public.security_alerts(created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.security_alerts TO authenticated;
GRANT ALL ON public.security_alerts TO service_role;
ALTER TABLE public.security_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "security_alerts_insert_self" ON public.security_alerts;
CREATE POLICY "security_alerts_insert_self" ON public.security_alerts
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

DROP POLICY IF EXISTS "security_alerts_read" ON public.security_alerts;
CREATE POLICY "security_alerts_read" ON public.security_alerts
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_permission(auth.uid(), 'security.view'));

DROP POLICY IF EXISTS "security_alerts_resolve" ON public.security_alerts;
CREATE POLICY "security_alerts_resolve" ON public.security_alerts
  FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(), 'security.view'))
  WITH CHECK (public.has_permission(auth.uid(), 'security.view'));

-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_behavior (
  user_id                   UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  risk_score                INTEGER NOT NULL DEFAULT 0,
  session_count             INTEGER NOT NULL DEFAULT 0,
  total_session_seconds     BIGINT NOT NULL DEFAULT 0,
  sensitive_action_count    INTEGER NOT NULL DEFAULT 0,
  last_sensitive_action_at  TIMESTAMPTZ,
  last_country              TEXT,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.user_behavior TO authenticated;
GRANT ALL ON public.user_behavior TO service_role;
ALTER TABLE public.user_behavior ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_behavior_own" ON public.user_behavior;
CREATE POLICY "user_behavior_own" ON public.user_behavior
  FOR ALL TO authenticated
  USING (auth.uid() = user_id OR public.has_permission(auth.uid(), 'security.view'))
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_user_behavior_updated ON public.user_behavior;
CREATE TRIGGER trg_user_behavior_updated
  BEFORE UPDATE ON public.user_behavior
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
