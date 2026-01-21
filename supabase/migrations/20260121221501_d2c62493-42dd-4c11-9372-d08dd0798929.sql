-- Drop and recreate view with SECURITY INVOKER to respect RLS
DROP VIEW IF EXISTS public.campaigns_with_stats;

CREATE VIEW public.campaigns_with_stats 
WITH (security_invoker = true)
AS
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
  FROM public.campaign_leads
  GROUP BY campaign_id
) stats ON stats.campaign_id = c.id;