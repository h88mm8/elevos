-- Add index for efficient client event queries
CREATE INDEX IF NOT EXISTS idx_usage_events_workspace_action_created 
ON public.usage_events(workspace_id, action, created_at);