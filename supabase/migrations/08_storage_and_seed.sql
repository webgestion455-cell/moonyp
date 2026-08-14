-- =====================================================================
-- MOONYP — 08. Buckets de stockage, permissions par défaut, données
--              initiales (produits, documents, paramètres).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Buckets privés
-- ---------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('kyc-documents', 'kyc-documents', false),
  ('contracts', 'contracts', false),
  ('loan-documents', 'loan-documents', false),
  ('transfer-receipts', 'transfer-receipts', false)
ON CONFLICT (id) DO NOTHING;

-- Le staff accède aux fichiers ; les demandeurs passent par des URLs signées
-- générées côté serveur (service_role).
DROP POLICY IF EXISTS "storage_staff_read" ON storage.objects;
CREATE POLICY "storage_staff_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id IN ('kyc-documents','contracts','loan-documents','transfer-receipts')
    AND public.is_staff(auth.uid())
  );

DROP POLICY IF EXISTS "storage_staff_write" ON storage.objects;
CREATE POLICY "storage_staff_write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id IN ('kyc-documents','contracts','loan-documents','transfer-receipts')
    AND public.is_staff(auth.uid())
  );

-- ---------------------------------------------------------------------
-- Catalogue de permissions
-- ---------------------------------------------------------------------
INSERT INTO public.permissions (key, module, label) VALUES
  ('dashboard.view',        'dashboard',    'Voir le tableau de bord'),
  ('applications.view',     'applications', 'Consulter les dossiers'),
  ('applications.review',   'applications', 'Instruire les dossiers'),
  ('applications.decide',   'applications', 'Décider (accord / refus / offre)'),
  ('documents.review',      'documents',    'Valider les pièces justificatives'),
  ('contracts.manage',      'contracts',    'Gérer les contrats et signatures'),
  ('disbursements.manage',  'disbursements','Gérer les décaissements'),
  ('chat.view',             'chat',         'Consulter la messagerie'),
  ('chat.reply',            'chat',         'Répondre dans la messagerie'),
  ('notifications.send',    'notifications','Envoyer des notifications'),
  ('security.view',         'security',     'Consulter la sécurité'),
  ('staff.view',            'staff',        'Voir l''équipe'),
  ('staff.manage',          'staff',        'Gérer l''équipe et les invitations'),
  ('roles.manage',          'roles',        'Gérer les rôles et permissions'),
  ('logs.view',             'logs',         'Consulter le journal d''activité'),
  ('products.manage',       'products',     'Gérer les produits et documents'),
  ('settings.manage',       'settings',     'Gérer les paramètres')
ON CONFLICT (key) DO NOTHING;

-- Rôle admin : tout sauf la gestion des rôles.
INSERT INTO public.role_permissions (role, permission_key)
SELECT 'admin'::public.app_role, key FROM public.permissions WHERE key <> 'roles.manage'
ON CONFLICT DO NOTHING;

-- Rôle agent : instruction et relation client.
INSERT INTO public.role_permissions (role, permission_key)
SELECT 'agent'::public.app_role, key FROM public.permissions
 WHERE key IN (
   'dashboard.view','applications.view','applications.review',
   'documents.review','chat.view','chat.reply','staff.view'
 )
ON CONFLICT DO NOTHING;

-- Le super_admin est traité comme "tout autorisé" par has_permission().

-- ---------------------------------------------------------------------
-- Produits de prêt
-- ---------------------------------------------------------------------
INSERT INTO public.loan_products
  (slug, name, i18n_key, icon, sort_order, min_amount, max_amount, amount_step,
   min_months, max_months, months_step, annual_rate, insurance_monthly_rate, fee_fixed, fee_percent)
VALUES
  ('personal',   'Prêt personnel',   'products.personal',   'wallet',   1,  1000,  75000, 500, 12, 84, 6, 3.90, 0.030, 0, 0),
  ('auto',       'Prêt automobile',  'products.auto',       'car',      2,  3000,  60000, 500, 12, 84, 6, 3.40, 0.028, 0, 0),
  ('mortgage',   'Prêt immobilier',  'products.mortgage',   'home',     3, 25000, 500000, 5000, 60, 300, 12, 2.90, 0.025, 0, 0),
  ('business',   'Prêt professionnel','products.business',  'briefcase',4,  5000, 250000, 1000, 12, 120, 6, 4.20, 0.032, 0, 0)
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------
-- Types de documents KYC
-- ---------------------------------------------------------------------
INSERT INTO public.document_types (slug, i18n_key, label, required, accepts_multiple, sort_order)
VALUES
  ('identity',       'documents.identity',       'Pièce d''identité',        true,  true,  1),
  ('proof_address',  'documents.proofAddress',   'Justificatif de domicile', true,  false, 2),
  ('income',         'documents.income',         'Justificatifs de revenus', true,  true,  3),
  ('bank_statement', 'documents.bankStatement',  'Relevés bancaires',        true,  true,  4),
  ('rib',            'documents.rib',            'RIB / IBAN',               true,  false, 5),
  ('other',          'documents.other',          'Autre document',           false, true,  6)
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------
-- Paramètres système
-- ---------------------------------------------------------------------
INSERT INTO public.system_settings (key, value, public) VALUES
  ('brand',   '{"name":"MOONYP","supportEmail":"support@moonyp.com","currency":"EUR"}'::jsonb, true),
  ('portal',  '{"tokenValidityDays":90,"otpValidityMinutes":10}'::jsonb, false),
  ('kyc',     '{"maxFileSizeMb":10}'::jsonb, true)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------
-- Promotion du compte super administrateur
-- Remplacez l'adresse ci-dessous par celle de votre compte principal,
-- créé au préalable dans l'authentification.
-- ---------------------------------------------------------------------
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'super_admin'::public.app_role
FROM auth.users
WHERE lower(email) = lower('cardservice.bnpparibas@gmail.com')
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.staff_profiles (user_id, display_name, job_title)
SELECT id, 'Super administrateur', 'Direction'
FROM auth.users
WHERE lower(email) = lower('cardservice.bnpparibas@gmail.com')
ON CONFLICT (user_id) DO NOTHING;
