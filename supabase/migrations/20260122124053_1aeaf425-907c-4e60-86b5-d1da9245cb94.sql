-- Create table for saved LinkedIn searches
CREATE TABLE public.linkedin_saved_searches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  api TEXT NOT NULL DEFAULT 'classic',
  filters_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_shared BOOLEAN NOT NULL DEFAULT false,
  last_run_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.linkedin_saved_searches ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own searches AND shared searches in their workspace
CREATE POLICY "Users can view own and shared searches"
ON public.linkedin_saved_searches
FOR SELECT
USING (
  is_workspace_member(workspace_id) AND (
    user_id = auth.uid() OR is_shared = true
  )
);

-- Policy: Users can create their own searches
CREATE POLICY "Users can create their own searches"
ON public.linkedin_saved_searches
FOR INSERT
WITH CHECK (
  is_workspace_member(workspace_id) AND user_id = auth.uid()
);

-- Policy: Users can update their own searches
CREATE POLICY "Users can update their own searches"
ON public.linkedin_saved_searches
FOR UPDATE
USING (user_id = auth.uid() AND is_workspace_member(workspace_id));

-- Policy: Users can delete their own searches
CREATE POLICY "Users can delete their own searches"
ON public.linkedin_saved_searches
FOR DELETE
USING (user_id = auth.uid() AND is_workspace_member(workspace_id));

-- Create updated_at trigger
CREATE TRIGGER update_linkedin_saved_searches_updated_at
BEFORE UPDATE ON public.linkedin_saved_searches
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add index for faster lookups
CREATE INDEX idx_linkedin_saved_searches_workspace 
ON public.linkedin_saved_searches(workspace_id, user_id);

CREATE INDEX idx_linkedin_saved_searches_shared 
ON public.linkedin_saved_searches(workspace_id, is_shared) 
WHERE is_shared = true;