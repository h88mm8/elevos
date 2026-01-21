-- Tabela de configurações do workspace
CREATE TABLE public.workspace_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL UNIQUE,
  daily_message_limit INTEGER NOT NULL DEFAULT 50,
  message_interval_seconds INTEGER NOT NULL DEFAULT 15,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger para updated_at
CREATE TRIGGER update_workspace_settings_updated_at
  BEFORE UPDATE ON public.workspace_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- RLS para workspace_settings
ALTER TABLE public.workspace_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view settings" ON public.workspace_settings
  FOR SELECT USING (is_workspace_member(workspace_id));

CREATE POLICY "Admins can insert settings" ON public.workspace_settings
  FOR INSERT WITH CHECK (is_workspace_admin(workspace_id));

CREATE POLICY "Admins can update settings" ON public.workspace_settings
  FOR UPDATE USING (is_workspace_admin(workspace_id));

-- Tabela de fila de campanhas
CREATE TABLE public.campaign_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  scheduled_date DATE NOT NULL,
  leads_to_send INTEGER NOT NULL DEFAULT 0,
  leads_sent INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

-- RLS para campaign_queue
ALTER TABLE public.campaign_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view queue" ON public.campaign_queue
  FOR SELECT USING (is_workspace_member(workspace_id));

CREATE POLICY "Members can insert queue" ON public.campaign_queue
  FOR INSERT WITH CHECK (is_workspace_member(workspace_id));

CREATE POLICY "Members can update queue" ON public.campaign_queue
  FOR UPDATE USING (is_workspace_member(workspace_id));

CREATE POLICY "Members can delete queue" ON public.campaign_queue
  FOR DELETE USING (is_workspace_member(workspace_id));