-- Add tracking columns to linkedin_profiles for async processing
ALTER TABLE public.linkedin_profiles
ADD COLUMN IF NOT EXISTS apify_run_id TEXT,
ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'processing';

-- Create index for efficient polling of pending runs
CREATE INDEX IF NOT EXISTS idx_linkedin_profiles_status ON public.linkedin_profiles(status) WHERE status = 'processing';
CREATE INDEX IF NOT EXISTS idx_linkedin_profiles_apify_run ON public.linkedin_profiles(apify_run_id) WHERE apify_run_id IS NOT NULL;

-- Create enrichment_jobs table for tracking bulk enrichment requests
CREATE TABLE IF NOT EXISTS public.enrichment_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL,
  user_id UUID NOT NULL,
  apify_run_id TEXT NOT NULL,
  lead_ids UUID[] NOT NULL,
  mode TEXT NOT NULL DEFAULT 'profile_only',
  status TEXT NOT NULL DEFAULT 'processing',
  total_leads INTEGER NOT NULL DEFAULT 0,
  enriched_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Enable RLS
ALTER TABLE public.enrichment_jobs ENABLE ROW LEVEL SECURITY;

-- RLS policies for enrichment_jobs
CREATE POLICY "Members can view their workspace jobs" 
ON public.enrichment_jobs 
FOR SELECT 
USING (is_workspace_member(workspace_id));

CREATE POLICY "System can insert jobs" 
ON public.enrichment_jobs 
FOR INSERT 
WITH CHECK (is_workspace_member(workspace_id));

CREATE POLICY "System can update jobs" 
ON public.enrichment_jobs 
FOR UPDATE 
USING (is_workspace_member(workspace_id));

-- Index for efficient polling
CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_status ON public.enrichment_jobs(status) WHERE status = 'processing';