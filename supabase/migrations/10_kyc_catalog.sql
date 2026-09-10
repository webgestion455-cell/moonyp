-- ---------------------------------------------------------------------
-- 10 — Catalogue KYC bancaire (modernisation)
--
-- À exécuter sur la base du projet, à la suite de supabase/migrations/09.
-- (Le dossier supabase/migrations est géré par l'outillage de la plateforme :
--  ce fichier est livré ici et doit être appliqué tel quel, sans modification.)
--
-- Le parcours d'identité est entièrement piloté par la donnée : c'est cette
-- table qui décide des pièces demandées, du mode de capture (scan simple,
-- recto/verso, contrôle de vivacité, import de fichier) et des justificatifs
-- exigés selon la situation professionnelle déclarée.
--
-- Cette migration :
--   1. aligne le vocabulaire des colonnes sur le moteur applicatif
--      (`capture_mode` : scan | scan_double | selfie | upload,
--       `category`     : identity | address | selfie | bank | income | other) ;
--   2. installe le catalogue complet des pièces ;
--   3. retire du parcours les entrées génériques historiques, sans les
--      supprimer : les dossiers déjà déposés conservent leurs références.
-- ---------------------------------------------------------------------

-- 1. Normalisation du vocabulaire existant ----------------------------------
UPDATE public.document_types SET category = 'bank'  WHERE category = 'banking';
UPDATE public.document_types SET capture_mode = 'scan' WHERE capture_mode IN ('camera', 'both');

ALTER TABLE public.document_types DROP CONSTRAINT IF EXISTS document_types_category_check;
ALTER TABLE public.document_types
  ADD CONSTRAINT document_types_category_check
  CHECK (category IN ('identity', 'address', 'selfie', 'bank', 'income', 'other'));

ALTER TABLE public.document_types DROP CONSTRAINT IF EXISTS document_types_capture_mode_check;
ALTER TABLE public.document_types
  ADD CONSTRAINT document_types_capture_mode_check
  CHECK (capture_mode IN ('scan', 'scan_double', 'selfie', 'upload'));

ALTER TABLE public.document_types DROP CONSTRAINT IF EXISTS document_types_sides_check;
ALTER TABLE public.document_types
  ADD CONSTRAINT document_types_sides_check CHECK (sides BETWEEN 1 AND 2);

-- 2. Catalogue moderne -------------------------------------------------------
-- `sides = 2` + `capture_mode = 'scan_double'` déclenche la capture recto/verso
-- conditionnelle : elle n'est exigée que pour les pièces qui la justifient
-- (carte d'identité, titre de séjour, permis), jamais pour un passeport.
INSERT INTO public.document_types
  (slug, i18n_key, label, required, accepts_multiple, max_size_mb, sort_order,
   category, capture_mode, sides, employment_statuses)
VALUES
  -- Identité : le demandeur choisit UNE pièce parmi celles proposées.
  ('id_national_id',      'kyc.docs.nationalId',      'Carte nationale d''identité',   true,  false, 10, 10, 'identity', 'scan_double', 2, ARRAY[]::TEXT[]),
  ('id_passport',         'kyc.docs.passport',        'Passeport',                     true,  false, 10, 11, 'identity', 'scan',        1, ARRAY[]::TEXT[]),
  ('id_residence_permit', 'kyc.docs.residencePermit', 'Titre de séjour',               true,  false, 10, 12, 'identity', 'scan_double', 2, ARRAY[]::TEXT[]),
  ('id_driving_licence',  'kyc.docs.drivingLicence',  'Permis de conduire',            true,  false, 10, 13, 'identity', 'scan_double', 2, ARRAY[]::TEXT[]),

  -- Domicile : une seule preuve de moins de trois mois.
  ('address_electricity', 'kyc.docs.electricity',     'Facture d''électricité',        true,  false, 10, 20, 'address',  'upload',      1, ARRAY[]::TEXT[]),
  ('address_water',       'kyc.docs.water',           'Facture d''eau',                true,  false, 10, 21, 'address',  'upload',      1, ARRAY[]::TEXT[]),
  ('address_telecom',     'kyc.docs.telecom',         'Facture téléphone / internet',  true,  false, 10, 22, 'address',  'upload',      1, ARRAY[]::TEXT[]),
  ('address_hosting',     'kyc.docs.hosting',         'Attestation d''hébergement',    true,  false, 10, 23, 'address',  'upload',      1, ARRAY[]::TEXT[]),

  -- Contrôle de vivacité : capture caméra frontale obligatoire.
  ('selfie_liveness',     'kyc.docs.selfie',          'Vérification du visage',        true,  false,  8, 30, 'selfie',   'selfie',      1, ARRAY[]::TEXT[]),

  -- Coordonnées bancaires.
  ('bank_statement',      'kyc.docs.bankStatement',   'Relevé bancaire (3 mois)',      true,  true,  15, 40, 'bank',     'upload',      1, ARRAY[]::TEXT[]),

  -- Revenus : conditionnés à la situation professionnelle déclarée.
  ('income_payslip',      'kyc.docs.payslip',         'Bulletins de salaire (3 mois)', true,  true,  15, 50, 'income',   'upload',      1, ARRAY['employee','civil_servant']::TEXT[]),
  ('income_tax_return',   'kyc.docs.taxReturn',       'Avis d''imposition',            true,  false, 15, 51, 'income',   'upload',      1, ARRAY['self_employed','business_owner','other','unemployed','student']::TEXT[]),
  ('income_kbis',         'kyc.docs.kbis',            'Extrait Kbis',                  true,  false, 10, 52, 'income',   'upload',      1, ARRAY['self_employed','business_owner']::TEXT[]),
  ('income_pension',      'kyc.docs.pension',         'Attestation de pension',        true,  false, 10, 53, 'income',   'upload',      1, ARRAY['retired']::TEXT[]),
  ('income_benefits',     'kyc.docs.benefits',        'Attestation d''allocations',    true,  false, 10, 54, 'income',   'upload',      1, ARRAY['unemployed','student','other']::TEXT[])
ON CONFLICT (slug) DO UPDATE SET
  i18n_key            = EXCLUDED.i18n_key,
  label               = EXCLUDED.label,
  required            = EXCLUDED.required,
  accepts_multiple    = EXCLUDED.accepts_multiple,
  max_size_mb         = EXCLUDED.max_size_mb,
  sort_order          = EXCLUDED.sort_order,
  category            = EXCLUDED.category,
  capture_mode        = EXCLUDED.capture_mode,
  sides               = EXCLUDED.sides,
  employment_statuses = EXCLUDED.employment_statuses,
  active              = true;

-- 3. Entrées génériques historiques : hors parcours, mais conservées ---------
-- « other » reste actif : il permet le dépôt libre d'une pièce complémentaire
-- demandée par la conformité depuis l'espace client sécurisé.
UPDATE public.document_types
   SET active = false
 WHERE slug IN ('identity', 'proof_address', 'income', 'rib');

UPDATE public.document_types
   SET required = false, category = 'other', capture_mode = 'upload', sort_order = 90
 WHERE slug = 'other';
