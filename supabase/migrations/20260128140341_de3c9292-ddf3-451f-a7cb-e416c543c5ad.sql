-- Create unipile_events table for storing webhook events
CREATE TABLE IF NOT EXISTS public.unipile_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'unipile',
  account_id TEXT,
  event_type TEXT NOT NULL,
  object_type TEXT,
  object_id TEXT,
  campaign_lead_id UUID REFERENCES public.campaign_leads(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  payload JSONB NOT NULL DEFAULT '{}',
  matched BOOLEAN NOT NULL DEFAULT false,
  processed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Unique constraint on event_id to ensure idempotency
CREATE UNIQUE INDEX IF NOT EXISTS unipile_events_event_id_unique ON public.unipile_events(event_id);

-- Indexes for lookups
CREATE INDEX IF NOT EXISTS unipile_events_account_id_idx ON public.unipile_events(account_id);
CREATE INDEX IF NOT EXISTS unipile_events_campaign_lead_id_idx ON public.unipile_events(campaign_lead_id);
CREATE INDEX IF NOT EXISTS unipile_events_workspace_id_idx ON public.unipile_events(workspace_id);
CREATE INDEX IF NOT EXISTS unipile_events_event_type_idx ON public.unipile_events(event_type);
CREATE INDEX IF NOT EXISTS unipile_events_created_at_idx ON public.unipile_events(created_at DESC);

-- Enable RLS
ALTER TABLE public.unipile_events ENABLE ROW LEVEL SECURITY;

-- Policy: Members can view their workspace events
CREATE POLICY "Members can view workspace events"
ON public.unipile_events
FOR SELECT
USING (is_workspace_member(workspace_id));

-- Policy: System can insert (via service role, no specific user context)
CREATE POLICY "System can insert events"
ON public.unipile_events
FOR INSERT
WITH CHECK (true);

-- Policy: System can update events  
CREATE POLICY "System can update events"
ON public.unipile_events
FOR UPDATE
USING (true);

-- Add accepted_at column to campaign_leads if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'campaign_leads' 
    AND column_name = 'accepted_at'
  ) THEN
    ALTER TABLE public.campaign_leads ADD COLUMN accepted_at TIMESTAMP WITH TIME ZONE;
  END IF;
END $$;

-- Comment for documentation
COMMENT ON TABLE public.unipile_events IS 'Stores raw webhook events from Unipile for messaging/invite actions with idempotency via event_id';
COMMENT ON COLUMN public.unipile_events.event_id IS 'Unique ID from Unipile webhook payload for idempotent processing';
COMMENT ON COLUMN public.unipile_events.matched IS 'Whether we successfully matched this event to a campaign_lead';