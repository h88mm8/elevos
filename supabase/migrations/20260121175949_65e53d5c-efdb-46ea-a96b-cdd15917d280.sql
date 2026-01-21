-- Add retry tracking to campaign_leads
ALTER TABLE public.campaign_leads 
ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;

-- Add max_retries setting to workspace_settings
ALTER TABLE public.workspace_settings 
ADD COLUMN IF NOT EXISTS max_retries integer NOT NULL DEFAULT 3;