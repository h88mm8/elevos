-- Add tracking columns to campaign_leads for message status tracking
ALTER TABLE public.campaign_leads 
ADD COLUMN IF NOT EXISTS provider_message_id TEXT,
ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS seen_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ;

-- Create index for faster webhook lookups by provider_message_id
CREATE INDEX IF NOT EXISTS idx_campaign_leads_provider_message_id 
ON public.campaign_leads (provider_message_id) 
WHERE provider_message_id IS NOT NULL;

-- Update campaign_leads status options (add delivered, seen, replied)
-- The status column is TEXT so we just need to ensure code handles new values

-- Add metrics columns to campaigns table for quick reporting
ALTER TABLE public.campaigns
ADD COLUMN IF NOT EXISTS delivered_count INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS seen_count INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS replied_count INTEGER NOT NULL DEFAULT 0;

-- Create campaign_events table for detailed event logging
CREATE TABLE IF NOT EXISTS public.campaign_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  campaign_lead_id UUID REFERENCES public.campaign_leads(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL, -- sent, delivered, seen, replied, failed
  provider_message_id TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on campaign_events
ALTER TABLE public.campaign_events ENABLE ROW LEVEL SECURITY;

-- RLS policy for campaign_events
CREATE POLICY "Users can view events of their campaigns" 
ON public.campaign_events 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.campaigns c
    WHERE c.id = campaign_events.campaign_id 
    AND is_workspace_member(c.workspace_id)
  )
);

-- Allow system inserts for campaign_events (via service role in webhooks)
CREATE POLICY "System can insert campaign events" 
ON public.campaign_events 
FOR INSERT 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.campaigns c
    WHERE c.id = campaign_events.campaign_id 
    AND is_workspace_member(c.workspace_id)
  )
);

-- Create index for faster event queries
CREATE INDEX IF NOT EXISTS idx_campaign_events_campaign_id ON public.campaign_events (campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_events_type ON public.campaign_events (event_type);