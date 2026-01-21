-- ============================================
-- 1) CREATE account_daily_usage TABLE
-- ============================================
CREATE TABLE public.account_daily_usage (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL,
  account_id text NOT NULL,
  action text NOT NULL,
  usage_date date NOT NULL,
  count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  -- Constraint to validate action type
  CONSTRAINT valid_action CHECK (action IN ('linkedin_message', 'linkedin_invite', 'whatsapp_message'))
);

-- Enable RLS
ALTER TABLE public.account_daily_usage ENABLE ROW LEVEL SECURITY;

-- Create unique index for atomic upsert
CREATE UNIQUE INDEX idx_account_daily_usage_unique 
ON public.account_daily_usage (workspace_id, account_id, action, usage_date);

-- Index for fast lookups
CREATE INDEX idx_account_daily_usage_workspace_date 
ON public.account_daily_usage (workspace_id, usage_date);

-- RLS Policies
CREATE POLICY "Members can view usage of their workspaces"
ON public.account_daily_usage
FOR SELECT
USING (is_workspace_member(workspace_id));

CREATE POLICY "System can insert/update usage"
ON public.account_daily_usage
FOR INSERT
WITH CHECK (is_workspace_member(workspace_id));

CREATE POLICY "System can update usage"
ON public.account_daily_usage
FOR UPDATE
USING (is_workspace_member(workspace_id));

-- Trigger for updated_at
CREATE TRIGGER update_account_daily_usage_updated_at
BEFORE UPDATE ON public.account_daily_usage
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- 2) CREATE increment_daily_usage RPC
-- ============================================
CREATE OR REPLACE FUNCTION public.increment_daily_usage(
  p_workspace_id uuid,
  p_account_id text,
  p_action text,
  p_usage_date date,
  p_increment integer DEFAULT 1
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  new_count integer;
BEGIN
  -- Validate action
  IF p_action NOT IN ('linkedin_message', 'linkedin_invite', 'whatsapp_message') THEN
    RAISE EXCEPTION 'Invalid action: %. Use linkedin_message, linkedin_invite, or whatsapp_message', p_action;
  END IF;

  -- Atomic upsert with increment
  INSERT INTO public.account_daily_usage (workspace_id, account_id, action, usage_date, count)
  VALUES (p_workspace_id, p_account_id, p_action, p_usage_date, p_increment)
  ON CONFLICT (workspace_id, account_id, action, usage_date)
  DO UPDATE SET 
    count = account_daily_usage.count + p_increment,
    updated_at = now()
  RETURNING count INTO new_count;

  RETURN new_count;
END;
$$;

-- ============================================
-- 3) CREATE get_daily_usage RPC
-- ============================================
CREATE OR REPLACE FUNCTION public.get_daily_usage(
  p_workspace_id uuid,
  p_account_id text,
  p_action text,
  p_usage_date date
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  current_count integer;
BEGIN
  SELECT count INTO current_count
  FROM public.account_daily_usage
  WHERE workspace_id = p_workspace_id
    AND account_id = p_account_id
    AND action = p_action
    AND usage_date = p_usage_date;
  
  RETURN COALESCE(current_count, 0);
END;
$$;

-- ============================================
-- 4) CREATE get_workspace_daily_usage RPC (for UI)
-- ============================================
CREATE OR REPLACE FUNCTION public.get_workspace_daily_usage(
  p_workspace_id uuid,
  p_usage_date date
)
RETURNS TABLE (
  account_id text,
  action text,
  count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    adu.account_id,
    adu.action,
    adu.count
  FROM public.account_daily_usage adu
  WHERE adu.workspace_id = p_workspace_id
    AND adu.usage_date = p_usage_date;
END;
$$;