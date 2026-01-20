-- Create a cache table for WhatsApp contact profiles
CREATE TABLE public.contact_profiles_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  phone_identifier TEXT NOT NULL,
  display_name TEXT,
  profile_picture TEXT,
  cached_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, phone_identifier)
);

-- Enable RLS
ALTER TABLE public.contact_profiles_cache ENABLE ROW LEVEL SECURITY;

-- Create policies for workspace members
CREATE POLICY "Workspace members can view cached profiles" 
ON public.contact_profiles_cache 
FOR SELECT 
USING (public.is_workspace_member(workspace_id));

CREATE POLICY "Workspace members can insert cached profiles" 
ON public.contact_profiles_cache 
FOR INSERT 
WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "Workspace members can update cached profiles" 
ON public.contact_profiles_cache 
FOR UPDATE 
USING (public.is_workspace_member(workspace_id));

-- Create index for faster lookups
CREATE INDEX idx_contact_profiles_cache_lookup 
ON public.contact_profiles_cache(workspace_id, phone_identifier);

-- Create index for cache cleanup (older than 24h)
CREATE INDEX idx_contact_profiles_cache_age 
ON public.contact_profiles_cache(cached_at);