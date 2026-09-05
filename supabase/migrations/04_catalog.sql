-- =====================================================================
-- MOONYP — 04. Catalogue : produits de prêt, types de documents KYC,
--              moyens de paiement, paramètres système.
-- Dépend de : 01_core.sql (is_staff, update_updated_at_column),
--             02_rbac_staff.sql (has_permission).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Produits de prêt (configurables depuis l'administration)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.loan_products (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                        TEXT NOT NULL UNIQUE,
  name                        TEXT NOT NULL,
  i18n_key                    TEXT,
  description                 TEXT,
  icon                        TEXT,
  active                      BOOLEAN NOT NULL DEFAULT true,
  sort_order                  INTEGER NOT NULL DEFAULT 0,
  min_amount                  NUMERIC(14,2) NOT NULL DEFAULT 1000,
  max_amount                  NUMERIC(14,2) NOT NULL DEFAULT 75000,
  amount_step                 NUMERIC(14,2) NOT NULL DEFAULT 500,
  min_months                  INTEGER NOT NULL DEFAULT 12,
  max_months                  INTEGER NOT NULL DEFAULT 84,
  months_step                 INTEGER NOT NULL DEFAULT 6,
  annual_rate                 NUMERIC(6,3) NOT NULL DEFAULT 3.9,
  insurance_monthly_rate      NUMERIC(6,4) NOT NULL DEFAULT 0.03,
  fee_fixed                   NUMERIC(12,2) NOT NULL DEFAULT 0,
  fee_percent                 NUMERIC(6,3) NOT NULL DEFAULT 0,
  currency                    TEXT NOT NULL DEFAULT 'EUR',
  countries                   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  -- Paramètres d'octroi (phase 6)
  repayment_frequency         TEXT NOT NULL DEFAULT 'monthly',
  grace_period_months         INTEGER NOT NULL DEFAULT 0,
  early_repayment_fee_percent NUMERIC(6,3) NOT NULL DEFAULT 0,
  max_dti_percent             NUMERIC(6,2) NOT NULL DEFAULT 40,
  requires_income_proof       BOOLEAN NOT NULL DEFAULT true,
  requires_collateral         BOOLEAN NOT NULL DEFAULT false,
  allowed_id_documents        TEXT[] NOT NULL DEFAULT ARRAY['passport','id_card']::TEXT[],
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.loan_products TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.loan_products TO authenticated;
GRANT ALL ON public.loan_products TO service_role;
ALTER TABLE public.loan_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "loan_products_public_read" ON public.loan_products;
CREATE POLICY "loan_products_public_read" ON public.loan_products
  FOR SELECT TO anon, authenticated USING (active = true OR public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "loan_products_manage" ON public.loan_products;
CREATE POLICY "loan_products_manage" ON public.loan_products
  FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'products.manage'))
  WITH CHECK (public.has_permission(auth.uid(), 'products.manage'));

DROP TRIGGER IF EXISTS trg_loan_products_updated ON public.loan_products;
CREATE TRIGGER trg_loan_products_updated
  BEFORE UPDATE ON public.loan_products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- Types de documents KYC
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.document_types (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                TEXT NOT NULL UNIQUE,
  i18n_key            TEXT,
  label               TEXT NOT NULL,
  required            BOOLEAN NOT NULL DEFAULT true,
  accepts_multiple    BOOLEAN NOT NULL DEFAULT false,
  max_size_mb         INTEGER NOT NULL DEFAULT 10,
  allowed_mime        TEXT[] NOT NULL DEFAULT ARRAY['application/pdf','image/jpeg','image/png']::TEXT[],
  active              BOOLEAN NOT NULL DEFAULT true,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  -- Pilotage du parcours KYC séquentiel (phase 4)
  category            TEXT NOT NULL DEFAULT 'identity',
  capture_mode        TEXT NOT NULL DEFAULT 'upload',   -- upload | camera | both
  sides               INTEGER NOT NULL DEFAULT 1,
  employment_statuses TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  countries           TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  product_slugs       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.document_types TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.document_types TO authenticated;
GRANT ALL ON public.document_types TO service_role;
ALTER TABLE public.document_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "document_types_public_read" ON public.document_types;
CREATE POLICY "document_types_public_read" ON public.document_types
  FOR SELECT TO anon, authenticated USING (active = true OR public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "document_types_manage" ON public.document_types;
CREATE POLICY "document_types_manage" ON public.document_types
  FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'products.manage'))
  WITH CHECK (public.has_permission(auth.uid(), 'products.manage'));

DROP TRIGGER IF EXISTS trg_document_types_updated ON public.document_types;
CREATE TRIGGER trg_document_types_updated
  BEFORE UPDATE ON public.document_types
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- Moyens de paiement (aucun secret fournisseur stocké ici)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_methods (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      TEXT NOT NULL DEFAULT 'bank_transfer',  -- bank_transfer | stripe | paypal | crypto
  kind          TEXT NOT NULL DEFAULT 'transfer',       -- transfer | card | wallet | crypto
  label         TEXT NOT NULL,
  holder        TEXT,
  iban          TEXT,
  bic           TEXT,
  bank_name     TEXT,
  card_brand    TEXT,
  card_last4    TEXT,
  address       TEXT,
  network       TEXT,
  qr_url        TEXT,
  instructions  TEXT,
  currency      TEXT NOT NULL DEFAULT 'EUR',
  min_amount    NUMERIC(12,2),
  max_amount    NUMERIC(12,2),
  active        BOOLEAN NOT NULL DEFAULT true,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_methods TO authenticated;
GRANT ALL ON public.payment_methods TO service_role;
ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;

-- Les demandeurs (sans compte) lisent les moyens actifs via server function
-- (service_role) : aucun accès anon direct.
DROP POLICY IF EXISTS "payment_methods_manage" ON public.payment_methods;
CREATE POLICY "payment_methods_manage" ON public.payment_methods
  FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'settings.manage'))
  WITH CHECK (public.has_permission(auth.uid(), 'settings.manage'));

DROP TRIGGER IF EXISTS trg_payment_methods_updated ON public.payment_methods;
CREATE TRIGGER trg_payment_methods_updated
  BEFORE UPDATE ON public.payment_methods
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- Paramètres système (clé/valeur JSON)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.system_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL DEFAULT '{}'::jsonb,
  public      BOOLEAN NOT NULL DEFAULT false,
  updated_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.system_settings TO anon, authenticated;
GRANT INSERT, UPDATE ON public.system_settings TO authenticated;
GRANT ALL ON public.system_settings TO service_role;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "system_settings_read" ON public.system_settings;
CREATE POLICY "system_settings_read" ON public.system_settings
  FOR SELECT TO anon, authenticated USING (public = true OR public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "system_settings_manage" ON public.system_settings;
CREATE POLICY "system_settings_manage" ON public.system_settings
  FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'settings.manage'))
  WITH CHECK (public.has_permission(auth.uid(), 'settings.manage'));

DROP TRIGGER IF EXISTS trg_system_settings_updated ON public.system_settings;
CREATE TRIGGER trg_system_settings_updated
  BEFORE UPDATE ON public.system_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
