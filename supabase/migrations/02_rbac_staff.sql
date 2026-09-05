-- =====================================================================
-- MOONYP — 02. RBAC granulaire, équipe interne, invitations, journal
--              d'audit, codes 2FA administrateur.
-- Dépend de : 01_core.sql (app_role, is_staff, is_super_admin,
--                          update_updated_at_column).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Catalogue de permissions
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.permissions (
  key         TEXT PRIMARY KEY,
  module      TEXT NOT NULL,
  label       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.permissions TO authenticated;
GRANT ALL ON public.permissions TO service_role;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "permissions_read_staff" ON public.permissions;
CREATE POLICY "permissions_read_staff" ON public.permissions
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

-- ---------------------------------------------------------------------
-- Matrice rôle → permission
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.role_permissions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role            public.app_role NOT NULL,
  permission_key  TEXT NOT NULL REFERENCES public.permissions(key) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (role, permission_key)
);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON public.role_permissions(role);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_permissions TO authenticated;
GRANT ALL ON public.role_permissions TO service_role;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "role_permissions_read_staff" ON public.role_permissions;
CREATE POLICY "role_permissions_read_staff" ON public.role_permissions
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "role_permissions_write_super" ON public.role_permissions;
CREATE POLICY "role_permissions_write_super" ON public.role_permissions
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- ---------------------------------------------------------------------
-- Résolution des permissions
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_permission(_user_id UUID, _permission TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin(_user_id)
      OR EXISTS (
        SELECT 1
        FROM public.user_roles ur
        JOIN public.role_permissions rp ON rp.role = ur.role
        WHERE ur.user_id = _user_id AND rp.permission_key = _permission
      );
$$;

-- Utilisée par le client : renvoie les clés de permission de l'appelant.
CREATE OR REPLACE FUNCTION public.my_permissions()
RETURNS TABLE (permission_key TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT rp.permission_key
  FROM public.user_roles ur
  JOIN public.role_permissions rp ON rp.role = ur.role
  WHERE ur.user_id = auth.uid();
$$;

REVOKE EXECUTE ON FUNCTION public.has_permission(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.my_permissions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_permission(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_permissions() TO authenticated;

-- ---------------------------------------------------------------------
-- Fiches équipe
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff_profiles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  TEXT,
  job_title     TEXT,
  phone         TEXT,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.staff_profiles TO authenticated;
GRANT ALL ON public.staff_profiles TO service_role;
ALTER TABLE public.staff_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_profiles_read_staff" ON public.staff_profiles;
CREATE POLICY "staff_profiles_read_staff" ON public.staff_profiles
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "staff_profiles_update_self_or_admin" ON public.staff_profiles;
CREATE POLICY "staff_profiles_update_self_or_admin" ON public.staff_profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR public.has_permission(auth.uid(), 'staff.manage'))
  WITH CHECK (auth.uid() = user_id OR public.has_permission(auth.uid(), 'staff.manage'));

DROP TRIGGER IF EXISTS trg_staff_profiles_updated ON public.staff_profiles;
CREATE TRIGGER trg_staff_profiles_updated
  BEFORE UPDATE ON public.staff_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- Invitations équipe (token haché uniquement)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff_invitations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT NOT NULL,
  role         public.app_role NOT NULL DEFAULT 'agent',
  full_name    TEXT,
  job_title    TEXT,
  token_hash   TEXT NOT NULL UNIQUE,
  invited_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  accepted_at  TIMESTAMPTZ,
  declined_at  TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_staff_invitations_email ON public.staff_invitations(email);

-- Écriture uniquement via server functions (service_role).
GRANT SELECT ON public.staff_invitations TO authenticated;
GRANT ALL ON public.staff_invitations TO service_role;
ALTER TABLE public.staff_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_invitations_read_manage" ON public.staff_invitations;
CREATE POLICY "staff_invitations_read_manage" ON public.staff_invitations
  FOR SELECT TO authenticated USING (public.has_permission(auth.uid(), 'staff.view'));

-- ---------------------------------------------------------------------
-- Journal d'activité (audit des actions staff)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email  TEXT,
  action       TEXT NOT NULL,
  entity       TEXT,
  entity_id    TEXT,
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip           TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON public.activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_actor ON public.activity_logs(actor_id);

GRANT SELECT, INSERT ON public.activity_logs TO authenticated;
GRANT ALL ON public.activity_logs TO service_role;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "activity_logs_read" ON public.activity_logs;
CREATE POLICY "activity_logs_read" ON public.activity_logs
  FOR SELECT TO authenticated USING (public.has_permission(auth.uid(), 'logs.view'));

DROP POLICY IF EXISTS "activity_logs_insert_self" ON public.activity_logs;
CREATE POLICY "activity_logs_insert_self" ON public.activity_logs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = actor_id);

-- ---------------------------------------------------------------------
-- Codes de vérification 2FA administrateur (hachés, jamais lisibles)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_verification_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash   TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used        BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_codes_user ON public.admin_verification_codes(user_id);

-- Aucun accès client : seul le service_role (server functions) y accède.
REVOKE ALL ON public.admin_verification_codes FROM anon, authenticated;
GRANT ALL ON public.admin_verification_codes TO service_role;
ALTER TABLE public.admin_verification_codes ENABLE ROW LEVEL SECURITY;

-- Policy explicite de refus : RLS activée sans policy = table opaque,
-- on rend l'intention lisible pour l'audit de sécurité.
DROP POLICY IF EXISTS "admin_codes_no_client_access" ON public.admin_verification_codes;
CREATE POLICY "admin_codes_no_client_access" ON public.admin_verification_codes
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
