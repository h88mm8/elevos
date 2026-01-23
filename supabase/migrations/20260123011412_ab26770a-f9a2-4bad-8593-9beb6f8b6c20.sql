-- Create linkedin_profiles table for storing raw Apify profile data
CREATE TABLE public.linkedin_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  raw_json JSONB NOT NULL,
  source TEXT NOT NULL DEFAULT 'apify',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create index for efficient lookups
CREATE INDEX idx_linkedin_profiles_lead_id ON public.linkedin_profiles(lead_id);
CREATE INDEX idx_linkedin_profiles_workspace_id ON public.linkedin_profiles(workspace_id);

-- Enable RLS
ALTER TABLE public.linkedin_profiles ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Members can view profiles" 
ON public.linkedin_profiles 
FOR SELECT 
USING (is_workspace_member(workspace_id));

CREATE POLICY "System can insert profiles" 
ON public.linkedin_profiles 
FOR INSERT 
WITH CHECK (is_workspace_member(workspace_id));

CREATE POLICY "Members can update profiles" 
ON public.linkedin_profiles 
FOR UPDATE 
USING (is_workspace_member(workspace_id));

-- Add missing columns to leads table
ALTER TABLE public.leads 
ADD COLUMN IF NOT EXISTS about TEXT,
ADD COLUMN IF NOT EXISTS skills TEXT[],
ADD COLUMN IF NOT EXISTS connections INTEGER,
ADD COLUMN IF NOT EXISTS followers INTEGER;

-- Update consume_workspace_quota to support linkedin_enrich_deep
CREATE OR REPLACE FUNCTION public.consume_workspace_quota(p_workspace_id uuid, p_action text, p_daily_limit integer, p_account_id text, p_user_id uuid DEFAULT NULL::uuid, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current_usage bigint;
  v_lock_key bigint;
  v_blocked_action text;
BEGIN
  -- Validate action (added linkedin_enrich_deep)
  IF p_action NOT IN ('linkedin_search_page', 'linkedin_enrich', 'linkedin_enrich_deep') THEN
    RAISE EXCEPTION 'Invalid action: %. Use linkedin_search_page, linkedin_enrich, or linkedin_enrich_deep', p_action;
  END IF;
  
  -- Create a unique lock key based on workspace + action
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
$function$;

-- Add daily_enrich_deep_limit to plans table
ALTER TABLE public.plans 
ADD COLUMN IF NOT EXISTS daily_enrich_deep_limit INTEGER NOT NULL DEFAULT 10;