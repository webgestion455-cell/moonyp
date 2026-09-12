DO $migration$
BEGIN
  IF to_regclass('public.application_guarantees') IS NOT NULL THEN
    ALTER TABLE public.application_guarantees
      ADD COLUMN IF NOT EXISTS document_version INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS document_hash TEXT,
      ADD COLUMN IF NOT EXISTS signed_document_hash TEXT,
      ADD COLUMN IF NOT EXISTS document_issued_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS signature_name TEXT,
      ADD COLUMN IF NOT EXISTS signature_method TEXT,
      ADD COLUMN IF NOT EXISTS signature_reference TEXT;
    GRANT SELECT, INSERT, UPDATE ON public.application_guarantees TO authenticated;
    GRANT ALL ON public.application_guarantees TO service_role;
    COMMENT ON COLUMN public.application_guarantees.document_hash IS 'Empreinte SHA-256 du PDF de garantie initial';
    COMMENT ON COLUMN public.application_guarantees.signed_document_hash IS 'Empreinte SHA-256 du PDF final lie a la preuve de signature du dossier';
  END IF;

  IF to_regclass('public.application_insurances') IS NOT NULL THEN
    ALTER TABLE public.application_insurances
      ADD COLUMN IF NOT EXISTS document_version INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS document_hash TEXT,
      ADD COLUMN IF NOT EXISTS signed_storage_path TEXT,
      ADD COLUMN IF NOT EXISTS signed_document_hash TEXT,
      ADD COLUMN IF NOT EXISTS document_issued_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS signature_name TEXT,
      ADD COLUMN IF NOT EXISTS signature_method TEXT,
      ADD COLUMN IF NOT EXISTS signature_reference TEXT;
    GRANT SELECT, INSERT, UPDATE ON public.application_insurances TO authenticated;
    GRANT ALL ON public.application_insurances TO service_role;
    COMMENT ON COLUMN public.application_insurances.document_hash IS 'Empreinte SHA-256 du PDF assurance initial';
    COMMENT ON COLUMN public.application_insurances.signed_document_hash IS 'Empreinte SHA-256 du PDF final lie a la preuve de signature du dossier';
  END IF;
END
$migration$;