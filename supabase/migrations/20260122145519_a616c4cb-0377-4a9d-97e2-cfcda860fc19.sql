-- Create RPC to get workspace daily usage with generate_series for gap filling
CREATE OR REPLACE FUNCTION public.get_workspace_usage_daily(p_workspace_id uuid, p_days int DEFAULT 7)
RETURNS TABLE(date date, action text, total_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH date_range AS (
    SELECT generate_series(
      (CURRENT_DATE - (p_days - 1)),
      CURRENT_DATE,
      '1 day'::interval
    )::date AS date
  ),
  actions AS (
    SELECT unnest(ARRAY[
      'linkedin_search_page',
      'linkedin_enrich',
      'linkedin_search_page_blocked',
      'linkedin_enrich_blocked'
    ]) AS action
  ),
  date_action_grid AS (
    SELECT d.date, a.action
    FROM date_range d
    CROSS JOIN actions a
  ),
  usage_aggregated AS (
    SELECT 
      (ue.created_at AT TIME ZONE 'UTC')::date AS usage_date,
      ue.action,
      SUM(ue.count) AS total_count
    FROM usage_events ue
    WHERE ue.workspace_id = p_workspace_id
      AND ue.created_at >= (CURRENT_DATE - (p_days - 1))::timestamp
      AND ue.action IN (
        'linkedin_search_page',
        'linkedin_enrich',
        'linkedin_search_page_blocked',
        'linkedin_enrich_blocked'
      )
    GROUP BY usage_date, ue.action
  )
  SELECT 
    dag.date,
    dag.action,
    COALESCE(ua.total_count, 0)::bigint AS total_count
  FROM date_action_grid dag
  LEFT JOIN usage_aggregated ua ON dag.date = ua.usage_date AND dag.action = ua.action
  ORDER BY dag.date ASC, dag.action ASC;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.get_workspace_usage_daily(uuid, int) TO authenticated;

-- Fix index on usage_events for efficient querying
CREATE INDEX IF NOT EXISTS idx_usage_events_workspace_action_created 
ON public.usage_events(workspace_id, action, created_at);

CREATE INDEX IF NOT EXISTS idx_usage_events_account_created 
ON public.usage_events(account_id, created_at);

-- Ensure usage_events.count has DEFAULT 1
ALTER TABLE public.usage_events ALTER COLUMN count SET DEFAULT 1;