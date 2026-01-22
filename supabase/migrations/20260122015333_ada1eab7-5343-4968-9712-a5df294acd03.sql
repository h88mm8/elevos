-- Adicionar coluna skip_reason para rastrear leads pulados em campanhas
ALTER TABLE public.campaign_leads ADD COLUMN IF NOT EXISTS skip_reason TEXT;

-- Adicionar limites de rate limiting para novas funcionalidades LinkedIn
ALTER TABLE public.workspace_settings 
  ADD COLUMN IF NOT EXISTS linkedin_daily_search_limit INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS linkedin_daily_profile_scrape_limit INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS linkedin_daily_like_limit INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS linkedin_daily_comment_limit INTEGER NOT NULL DEFAULT 5;

-- Criar tabela para ações de engajamento
CREATE TABLE IF NOT EXISTS public.engagement_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  linkedin_url TEXT NOT NULL,
  post_id TEXT,
  action_type TEXT NOT NULL CHECK (action_type IN ('like', 'comment', 'view_profile')),
  comment_text TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  executed_at TIMESTAMPTZ,
  error TEXT
);

-- Habilitar RLS
ALTER TABLE public.engagement_actions ENABLE ROW LEVEL SECURITY;

-- Políticas RLS para engagement_actions
CREATE POLICY "Members can view engagement actions"
  ON public.engagement_actions FOR SELECT
  USING (is_workspace_member(workspace_id));

CREATE POLICY "Members can create engagement actions"
  ON public.engagement_actions FOR INSERT
  WITH CHECK (is_workspace_member(workspace_id));

CREATE POLICY "Members can update engagement actions"
  ON public.engagement_actions FOR UPDATE
  USING (is_workspace_member(workspace_id));

CREATE POLICY "Members can delete engagement actions"
  ON public.engagement_actions FOR DELETE
  USING (is_workspace_member(workspace_id));

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_engagement_actions_workspace ON public.engagement_actions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_engagement_actions_lead ON public.engagement_actions(lead_id);
CREATE INDEX IF NOT EXISTS idx_engagement_actions_status ON public.engagement_actions(status);

-- Adicionar novas ações ao contador de uso diário
-- Vamos atualizar a função increment_daily_usage para aceitar mais tipos de ações
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
  -- Validate action - expanded list
  IF p_action NOT IN (
    'linkedin_message', 'linkedin_invite', 'whatsapp_message',
    'linkedin_search', 'linkedin_profile_scrape', 'linkedin_like', 'linkedin_comment'
  ) THEN
    RAISE EXCEPTION 'Invalid action: %. Use linkedin_message, linkedin_invite, whatsapp_message, linkedin_search, linkedin_profile_scrape, linkedin_like, or linkedin_comment', p_action;
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

-- Atualizar get_daily_usage para aceitar mais tipos
CREATE OR REPLACE FUNCTION public.get_daily_usage(
  p_workspace_id uuid, 
  p_account_id text, 
  p_action text, 
  p_usage_date date
)
RETURNS integer
LANGUAGE plpgsql
STABLE SECURITY DEFINER
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