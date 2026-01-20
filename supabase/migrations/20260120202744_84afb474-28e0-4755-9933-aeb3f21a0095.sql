-- Tabela de contas conectadas (WhatsApp, LinkedIn, Email, etc.)
CREATE TABLE public.accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'messaging',
  channel TEXT NOT NULL,
  account_id TEXT NOT NULL,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'connected',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índice único para evitar duplicatas
CREATE UNIQUE INDEX accounts_workspace_account_unique 
  ON public.accounts(workspace_id, account_id);

-- Índice para busca por channel
CREATE INDEX accounts_channel_idx ON public.accounts(channel);

-- Trigger para updated_at
CREATE TRIGGER update_accounts_updated_at
  BEFORE UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Habilitar RLS
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

-- SELECT: membros do workspace
CREATE POLICY "Members can view accounts" ON public.accounts
  FOR SELECT USING (is_workspace_member(workspace_id));

-- INSERT: admins (WITH CHECK)
CREATE POLICY "Admins can insert accounts" ON public.accounts
  FOR INSERT WITH CHECK (is_workspace_admin(workspace_id));

-- UPDATE: admins (USING)
CREATE POLICY "Admins can update accounts" ON public.accounts
  FOR UPDATE USING (is_workspace_admin(workspace_id));

-- DELETE: admins (USING)
CREATE POLICY "Admins can delete accounts" ON public.accounts
  FOR DELETE USING (is_workspace_admin(workspace_id));

-- Tabela de mensagens para webhook/auditoria
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  chat_id TEXT NOT NULL,
  external_id TEXT,
  sender TEXT NOT NULL,
  text TEXT,
  attachments JSONB,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices para busca
CREATE INDEX messages_chat_id_idx ON public.messages(chat_id);
CREATE INDEX messages_workspace_id_idx ON public.messages(workspace_id);
CREATE INDEX messages_timestamp_idx ON public.messages(timestamp DESC);

-- Habilitar RLS
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- SELECT: membros do workspace
CREATE POLICY "Members can view messages" ON public.messages
  FOR SELECT USING (is_workspace_member(workspace_id));

-- INSERT: sistema (webhook usa service role, não precisa de policy para usuários)
-- Webhook insere via service role que bypassa RLS

-- Habilitar realtime para mensagens
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;