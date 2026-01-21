-- ============================================
-- 1. UNIQUE INDEX ON campaign_queue (campaign_id, scheduled_date)
--    Ensures idempotent queue entries - prevents duplicates on retry
-- ============================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_queue_campaign_date 
ON public.campaign_queue (campaign_id, scheduled_date);

-- ============================================
-- 2. ADD timezone COLUMN TO workspaces
--    Used for proper scheduling of deferred campaigns
-- ============================================
ALTER TABLE public.workspaces 
ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC';

-- Add comment for documentation
COMMENT ON COLUMN public.workspaces.timezone IS 'IANA timezone identifier for scheduling (e.g., America/Sao_Paulo, UTC)';