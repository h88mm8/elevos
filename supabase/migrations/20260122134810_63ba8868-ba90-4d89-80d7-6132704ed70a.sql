-- =====================================================
-- TASK 1: Plans System with Limits
-- =====================================================

-- Table: plans (plan definitions with limits)
CREATE TABLE public.plans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  daily_search_page_limit INTEGER NOT NULL DEFAULT 20,
  daily_enrich_limit INTEGER NOT NULL DEFAULT 50,
  monthly_search_page_limit INTEGER,
  monthly_enrich_limit INTEGER,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Table: workspace_plans (links workspace to a plan)
CREATE TABLE public.workspace_plans (
  workspace_id UUID NOT NULL PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES public.plans(id),
  status TEXT NOT NULL DEFAULT 'active',
  starts_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  ends_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- =====================================================
-- TASK 2: Usage Events (Telemetry)
-- =====================================================

-- Table: usage_events (append-only telemetry)
CREATE TABLE public.usage_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID,
  action TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  metadata JSONB DEFAULT '{}'::jsonb,
  account_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add constraint for valid actions
ALTER TABLE public.usage_events ADD CONSTRAINT usage_events_action_check 
  CHECK (action IN ('linkedin_search_page', 'linkedin_enrich', 'linkedin_search_blocked', 'linkedin_enrich_blocked'));

-- =====================================================
-- Indexes for performance
-- =====================================================
CREATE INDEX idx_usage_events_workspace_id ON public.usage_events(workspace_id);
CREATE INDEX idx_usage_events_action ON public.usage_events(action);
CREATE INDEX idx_usage_events_created_at ON public.usage_events(created_at);
CREATE INDEX idx_usage_events_account_id ON public.usage_events(account_id);
CREATE INDEX idx_usage_events_workspace_action_date ON public.usage_events(workspace_id, action, created_at);

-- =====================================================
-- Seed initial plans
-- =====================================================
INSERT INTO public.plans (code, name, daily_search_page_limit, daily_enrich_limit, monthly_search_page_limit, monthly_enrich_limit, is_default) VALUES
  ('starter', 'Starter', 20, 50, NULL, NULL, true),
  ('pro', 'Pro', 60, 150, NULL, NULL, false),
  ('scale', 'Scale', 200, 500, NULL, NULL, false);

-- =====================================================
-- RLS Policies
-- =====================================================

-- Enable RLS
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

-- Plans: Everyone can read, only platform admins can write
CREATE POLICY "Anyone can view plans" ON public.plans FOR SELECT USING (true);
CREATE POLICY "Platform admins can manage plans" ON public.plans FOR ALL USING (is_platform_admin());

-- Workspace Plans: Members can read their workspace plan, platform admins can manage
CREATE POLICY "Members can view their workspace plan" ON public.workspace_plans 
  FOR SELECT USING (is_workspace_member(workspace_id));
CREATE POLICY "Platform admins can manage workspace plans" ON public.workspace_plans 
  FOR ALL USING (is_platform_admin());

-- Usage Events: Members can view their workspace events, system can insert
CREATE POLICY "Members can view their workspace events" ON public.usage_events 
  FOR SELECT USING (is_workspace_member(workspace_id));
CREATE POLICY "System can insert usage events" ON public.usage_events 
  FOR INSERT WITH CHECK (true);
CREATE POLICY "Platform admins can view all events" ON public.usage_events 
  FOR SELECT USING (is_platform_admin());

-- =====================================================
-- Database Functions
-- =====================================================

-- Function to get workspace plan with limits
CREATE OR REPLACE FUNCTION public.get_workspace_plan(p_workspace_id UUID)
RETURNS TABLE (
  plan_id UUID,
  plan_code TEXT,
  plan_name TEXT,
  daily_search_page_limit INTEGER,
  daily_enrich_limit INTEGER,
  monthly_search_page_limit INTEGER,
  monthly_enrich_limit INTEGER,
  status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id as plan_id,
    p.code as plan_code,
    p.name as plan_name,
    p.daily_search_page_limit,
    p.daily_enrich_limit,
    p.monthly_search_page_limit,
    p.monthly_enrich_limit,
    COALESCE(wp.status, 'active') as status
  FROM public.plans p
  LEFT JOIN public.workspace_plans wp ON wp.plan_id = p.id AND wp.workspace_id = p_workspace_id
  WHERE wp.workspace_id = p_workspace_id
     OR (wp.workspace_id IS NULL AND p.is_default = true)
  LIMIT 1;
END;
$$;

-- Function to get daily usage for a workspace
CREATE OR REPLACE FUNCTION public.get_workspace_usage_today(p_workspace_id UUID)
RETURNS TABLE (
  action TEXT,
  total_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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
    AND ue.action IN ('linkedin_search_page', 'linkedin_enrich')
  GROUP BY ue.action;
END;
$$;

-- Function to get usage summary for admin dashboard
CREATE OR REPLACE FUNCTION public.get_admin_usage_overview(p_days INTEGER DEFAULT 7)
RETURNS TABLE (
  date DATE,
  action TEXT,
  total_count BIGINT,
  unique_workspaces BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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
  GROUP BY DATE(ue.created_at), ue.action
  ORDER BY date DESC, action;
END;
$$;

-- Function to get top workspaces by usage
CREATE OR REPLACE FUNCTION public.get_top_workspaces_usage(p_days INTEGER DEFAULT 7, p_limit INTEGER DEFAULT 10)
RETURNS TABLE (
  workspace_id UUID,
  workspace_name TEXT,
  plan_code TEXT,
  search_pages BIGINT,
  enrichments BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only platform admins can call this
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Access denied: Platform admin required';
  END IF;

  RETURN QUERY
  SELECT 
    w.id as workspace_id,
    w.name as workspace_name,
    COALESCE(p.code, 'starter') as plan_code,
    COALESCE(SUM(CASE WHEN ue.action = 'linkedin_search_page' THEN ue.count ELSE 0 END), 0)::BIGINT as search_pages,
    COALESCE(SUM(CASE WHEN ue.action = 'linkedin_enrich' THEN ue.count ELSE 0 END), 0)::BIGINT as enrichments
  FROM public.workspaces w
  LEFT JOIN public.usage_events ue ON ue.workspace_id = w.id 
    AND ue.created_at >= CURRENT_DATE - (p_days || ' days')::INTERVAL
  LEFT JOIN public.workspace_plans wp ON wp.workspace_id = w.id
  LEFT JOIN public.plans p ON p.id = wp.plan_id
  GROUP BY w.id, w.name, p.code
  ORDER BY (search_pages + enrichments) DESC
  LIMIT p_limit;
END;
$$;

-- Function to get global account usage
CREATE OR REPLACE FUNCTION public.get_global_account_usage(p_days INTEGER DEFAULT 7)
RETURNS TABLE (
  account_id TEXT,
  date DATE,
  action TEXT,
  total_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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
  GROUP BY ue.account_id, DATE(ue.created_at), ue.action
  ORDER BY date DESC, account_id;
END;
$$;

-- Trigger to update updated_at
CREATE TRIGGER update_plans_updated_at
  BEFORE UPDATE ON public.plans
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_workspace_plans_updated_at
  BEFORE UPDATE ON public.workspace_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Assign default plan to existing workspaces
INSERT INTO public.workspace_plans (workspace_id, plan_id, status)
SELECT w.id, p.id, 'active'
FROM public.workspaces w
CROSS JOIN public.plans p
WHERE p.is_default = true
  AND NOT EXISTS (SELECT 1 FROM public.workspace_plans wp WHERE wp.workspace_id = w.id);