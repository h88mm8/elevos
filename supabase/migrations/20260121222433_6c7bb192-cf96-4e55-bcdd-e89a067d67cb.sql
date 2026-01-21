-- C) Update view to count by lead_id with final state logic using a simpler approach
-- Each lead should only be counted once based on their "best" status: sent > failed > pending
DROP VIEW IF EXISTS public.campaigns_with_stats;

CREATE VIEW public.campaigns_with_stats 
WITH (security_invoker = true)
AS
WITH lead_final_status AS (
  -- For each campaign+lead, determine the final status
  -- Priority: sent > failed > pending
  SELECT DISTINCT ON (campaign_id, lead_id)
    campaign_id,
    lead_id,
    status,
    CASE status
      WHEN 'sent' THEN 1
      WHEN 'failed' THEN 2
      WHEN 'pending' THEN 3
      ELSE 4
    END AS priority
  FROM public.campaign_leads
  ORDER BY campaign_id, lead_id, 
    CASE status
      WHEN 'sent' THEN 1
      WHEN 'failed' THEN 2
      WHEN 'pending' THEN 3
      ELSE 4
    END ASC
)
SELECT 
  c.*,
  COALESCE(stats.total_leads, 0)::integer AS actual_leads_count,
  COALESCE(stats.sent_leads, 0)::integer AS actual_sent_count,
  COALESCE(stats.failed_leads, 0)::integer AS actual_failed_count,
  COALESCE(stats.pending_leads, 0)::integer AS actual_pending_count
FROM public.campaigns c
LEFT JOIN (
  SELECT 
    campaign_id,
    COUNT(*) AS total_leads,
    COUNT(*) FILTER (WHERE status = 'sent') AS sent_leads,
    COUNT(*) FILTER (WHERE status = 'failed') AS failed_leads,
    COUNT(*) FILTER (WHERE status = 'pending') AS pending_leads
  FROM lead_final_status
  GROUP BY campaign_id
) stats ON stats.campaign_id = c.id;