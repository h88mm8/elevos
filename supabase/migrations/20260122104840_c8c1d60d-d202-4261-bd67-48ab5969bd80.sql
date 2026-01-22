-- 1) Garantir unicidade em platform_admins.user_id (já é PK, mas vamos garantir)
-- user_id já é PRIMARY KEY, então já é único

-- 2) Criar função RPC atômica para bootstrap com advisory lock
CREATE OR REPLACE FUNCTION public.bootstrap_platform_admin(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_admin_exists boolean;
  v_inserted boolean := false;
BEGIN
  -- Acquire advisory lock to prevent race conditions
  -- Lock ID 1001 is arbitrary but unique for this operation
  PERFORM pg_advisory_xact_lock(1001);
  
  -- Check if any admin exists
  SELECT EXISTS (SELECT 1 FROM public.platform_admins LIMIT 1) INTO v_admin_exists;
  
  IF v_admin_exists THEN
    -- Admin already exists, return without inserting
    RETURN jsonb_build_object(
      'created', false,
      'already_has_admin', true
    );
  END IF;
  
  -- No admin exists, insert this user
  INSERT INTO public.platform_admins (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;
  
  -- Check if we actually inserted (handles the edge case where same user calls twice)
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  
  RETURN jsonb_build_object(
    'created', v_inserted > 0,
    'already_has_admin', false
  );
END;
$$;

-- 3) Ajustar RPC get_platform_linkedin_search_account para retornar account_uuid corretamente
CREATE OR REPLACE FUNCTION public.get_platform_linkedin_search_account()
RETURNS TABLE(account_uuid uuid, account_id text, linkedin_feature text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    a.id as account_uuid,
    a.account_id,
    a.linkedin_feature
  FROM public.platform_settings ps
  JOIN public.accounts a ON a.id = ps.linkedin_search_account_id
  WHERE a.channel = 'linkedin' AND a.status = 'connected';
END;
$$;

-- 4) Ajustar RLS para platform_admins
-- Primeiro dropar políticas existentes
DROP POLICY IF EXISTS "Users can view their own admin status" ON public.platform_admins;

-- SELECT: usuário só pode ver se é admin (self-check)
CREATE POLICY "Users can view their own admin status"
ON public.platform_admins
FOR SELECT
USING (auth.uid() = user_id);

-- INSERT/UPDATE/DELETE bloqueados para client (só via service role/edge function)
-- Não criar políticas de INSERT/UPDATE/DELETE = bloqueado por padrão com RLS ativo

-- 5) Ajustar RLS para platform_settings
-- Dropar políticas existentes
DROP POLICY IF EXISTS "Platform admins can view settings" ON public.platform_settings;
DROP POLICY IF EXISTS "Platform admins can update settings" ON public.platform_settings;

-- SELECT: apenas platform admins podem ver
CREATE POLICY "Platform admins can view settings"
ON public.platform_settings
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE platform_admins.user_id = auth.uid()
  )
);

-- UPDATE via edge function com service role, não precisa de policy aqui
-- INSERT/DELETE não são necessários (singleton)