-- RPC: Atomically claim due queue entries with timezone support
-- Uses FOR UPDATE SKIP LOCKED to prevent concurrent processing
CREATE OR REPLACE FUNCTION public.claim_due_queue_entries(
  p_workspace_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 25
)
RETURNS TABLE (
  queue_id uuid,
  campaign_id uuid,
  workspace_id uuid,
  scheduled_date date,
  leads_to_send integer,
  leads_sent integer,
  workspace_timezone text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT cq.id, cq.campaign_id, cq.workspace_id, cq.scheduled_date, cq.leads_to_send, cq.leads_sent
    FROM campaign_queue cq
    JOIN workspaces w ON w.id = cq.workspace_id
    WHERE cq.status = 'queued'
      -- Filter by workspace if provided
      AND (p_workspace_id IS NULL OR cq.workspace_id = p_workspace_id)
      -- Check if scheduled_date is due based on workspace timezone
      -- We compare scheduled_date (DATE) with the current date in workspace timezone
      AND cq.scheduled_date <= (CURRENT_TIMESTAMP AT TIME ZONE COALESCE(w.timezone, 'UTC'))::date
    ORDER BY cq.created_at ASC
    LIMIT p_limit
    FOR UPDATE OF cq SKIP LOCKED
  )
  UPDATE campaign_queue cq
  SET status = 'processing', updated_at = now()
  FROM claimed c
  JOIN workspaces w ON w.id = c.workspace_id
  WHERE cq.id = c.id
  RETURNING cq.id AS queue_id, cq.campaign_id, cq.workspace_id, cq.scheduled_date, cq.leads_to_send, cq.leads_sent, COALESCE(w.timezone, 'UTC') AS workspace_timezone;
END;
$function$;

-- Add updated_at column to campaign_queue if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'campaign_queue' 
    AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE public.campaign_queue ADD COLUMN updated_at timestamp with time zone NOT NULL DEFAULT now();
  END IF;
END $$;