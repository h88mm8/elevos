-- ============================================
-- HARDENING: Atomic Quota + Fixed Telemetry
-- ============================================

-- Create indexes for performance (if not exist)
CREATE INDEX IF NOT EXISTS idx_usage_events_workspace_action_created 
ON public.usage_events (workspace_id, action, created_at);

CREATE INDEX IF NOT EXISTS idx_usage_events_account_created 
ON public.usage_events (account_id, created_at);

-- ============================================
-- 1. ATOMIC QUOTA CONSUMPTION RPC
-- ============================================
-- This function uses an advisory lock to prevent race conditions
-- when multiple requests try to consume quota simultaneously

CREATE OR REPLACE FUNCTION public.consume_workspace_quota(
  p_workspace_id uuid,
  p_action text,
  p_daily_limit int,
  p_account_id text,
  p_user_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_usage bigint;
  v_lock_key bigint;
  v_blocked_action text;
BEGIN
  -- Validate action
  IF p_action NOT IN ('linkedin_search_page', 'linkedin_enrich') THEN
    RAISE EXCEPTION 'Invalid action: %. Use linkedin_search_page or linkedin_enrich', p_action;
  END IF;
  
  -- Create a unique lock key based on workspace + action
  -- hashtext returns an integer suitable for advisory locks
  v_lock_key := hashtext(p_workspace_id::text || ':' || p_action);
  
  -- Acquire transaction-level advisory lock (blocks until lock is available)
  PERFORM pg_advisory_xact_lock(v_lock_key);
  
  -- Count today's usage for this action (only successful events, not blocked)
  SELECT COALESCE(SUM(count), 0)
  INTO v_current_usage
  FROM public.usage_events
  WHERE workspace_id = p_workspace_id
    AND action = p_action
    AND created_at >= CURRENT_DATE
    AND (metadata->>'blocked' IS NULL OR metadata->>'blocked' = 'false');
  
  -- Check if over limit
  IF v_current_usage >= p_daily_limit THEN
    -- Determine blocked action name
    v_blocked_action := p_action || '_blocked';
    
    -- Insert blocked event
    INSERT INTO public.usage_events (workspace_id, user_id, action, account_id, metadata, count)
    VALUES (
      p_workspace_id, 
      p_user_id, 
      v_blocked_action, 
      p_account_id, 
      jsonb_build_object('blocked', true, 'reason', 'daily_limit_reached') || p_metadata,
      1
    );
    
    -- Return denied response
    RETURN jsonb_build_object(
      'allowed', false,
      'current', v_current_usage,
      'limit', p_daily_limit,
      'action', p_action
    );
  END IF;
  
  -- Insert successful usage event
  INSERT INTO public.usage_events (workspace_id, user_id, action, account_id, metadata, count)
  VALUES (p_workspace_id, p_user_id, p_action, p_account_id, p_metadata, 1);
  
  -- Return allowed response
  RETURN jsonb_build_object(
    'allowed', true,
    'current', v_current_usage + 1,
    'limit', p_daily_limit,
    'action', p_action
  );
END;
$$;

-- ============================================
-- 2. UPDATE get_workspace_usage_today
-- ============================================
-- Include blocked actions in the response

CREATE OR REPLACE FUNCTION public.get_workspace_usage_today(p_workspace_id uuid)
RETURNS TABLE(action text, total_count bigint)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ue.action,
    SUM(ue.count)::BIGINT as total_count
  FROM public.usage_events ue
  WHERE ue.workspace_id = p_workspace_id
    AND ue.created_at >= CURRENT_DATE
    AND ue.action IN (
      'linkedin_search_page', 
      'linkedin_enrich',
      'linkedin_search_page_blocked',
      'linkedin_enrich_blocked'
    )
  GROUP BY ue.action;
END;
$$;

-- ============================================
-- 3. UPDATE get_admin_usage_overview
-- ============================================
-- Include blocked actions in the admin dashboard

CREATE OR REPLACE FUNCTION public.get_admin_usage_overview(p_days int DEFAULT 7)
RETURNS TABLE(date date, action text, total_count bigint, unique_workspaces bigint)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only platform admins can call this
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Access denied: Platform admin required';
  END IF;

  RETURN QUERY
  SELECT 
    DATE(ue.created_at) as date,
    ue.action,
    SUM(ue.count)::BIGINT as total_count,
    COUNT(DISTINCT ue.workspace_id)::BIGINT as unique_workspaces
  FROM public.usage_events ue
  WHERE ue.created_at >= CURRENT_DATE - (p_days || ' days')::INTERVAL
    AND ue.action IN (
      'linkedin_search_page',
      'linkedin_enrich',
      'linkedin_search_page_blocked',
      'linkedin_enrich_blocked'
    )
  GROUP BY DATE(ue.created_at), ue.action
  ORDER BY date DESC, action;
END;
$$;

-- ============================================
-- 4. UPDATE get_global_account_usage
-- ============================================
-- Include blocked actions for global account monitoring

CREATE OR REPLACE FUNCTION public.get_global_account_usage(p_days int DEFAULT 7)
RETURNS TABLE(account_id text, date date, action text, total_count bigint)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only platform admins can call this
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Access denied: Platform admin required';
  END IF;

  RETURN QUERY
  SELECT 
    ue.account_id,
    DATE(ue.created_at) as date,
    ue.action,
    SUM(ue.count)::BIGINT as total_count
  FROM public.usage_events ue
  WHERE ue.created_at >= CURRENT_DATE - (p_days || ' days')::INTERVAL
    AND ue.account_id IS NOT NULL
    AND ue.action IN (
      'linkedin_search_page',
      'linkedin_enrich',
      'linkedin_search_page_blocked',
      'linkedin_enrich_blocked'
    )
  GROUP BY ue.account_id, DATE(ue.created_at), ue.action
  ORDER BY date DESC, account_id;
END;
$$;

-- ============================================
-- 5. GRANT EXECUTE on new RPC
-- ============================================
-- The consume_workspace_quota is SECURITY DEFINER so it runs as owner
-- This allows edge functions (using service role) to use it