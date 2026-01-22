-- Create RPC for client-side telemetry events
-- This is SECURITY DEFINER to allow authenticated users to log events
-- with an allowlist to prevent abuse
CREATE OR REPLACE FUNCTION public.log_client_event(
  p_workspace_id uuid,
  p_action text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Allowlist of permitted client actions to prevent abuse
  IF p_action NOT IN ('upgrade_cta_shown', 'upgrade_cta_clicked') THEN
    RAISE EXCEPTION 'Action not allowed: %', p_action;
  END IF;

  -- Verify user is member of workspace
  IF NOT is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'Access denied: not a workspace member';
  END IF;

  -- Insert event with source marker
  INSERT INTO public.usage_events (
    workspace_id,
    user_id,
    action,
    account_id,
    metadata,
    count
  ) VALUES (
    p_workspace_id,
    auth.uid(),
    p_action,
    null,
    p_metadata || jsonb_build_object('source', 'client'),
    1
  );
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.log_client_event(uuid, text, jsonb) TO authenticated;