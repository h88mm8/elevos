-- A) Ensure platform_settings singleton row exists
INSERT INTO public.platform_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- E) Add new enrichment fields to leads table
ALTER TABLE public.leads 
ADD COLUMN IF NOT EXISTS linkedin_public_identifier text,
ADD COLUMN IF NOT EXISTS linkedin_provider_id text,
ADD COLUMN IF NOT EXISTS linkedin_profile_json jsonb;

-- Rename enriched_at to last_enriched_at if enriched_at exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'enriched_at'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'last_enriched_at'
  ) THEN
    ALTER TABLE public.leads RENAME COLUMN enriched_at TO last_enriched_at;
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'last_enriched_at'
  ) THEN
    ALTER TABLE public.leads ADD COLUMN last_enriched_at timestamptz;
  END IF;
END $$;

-- Add updated_by to platform_settings for audit trail
ALTER TABLE public.platform_settings 
ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id);