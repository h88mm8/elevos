-- =====================================================
-- FASE 1.1: Stored Procedures para Créditos Atômicos
-- =====================================================
-- Documentação:
-- - reference_id é OBRIGATÓRIO para operações externas (deduct/rollback)
-- - reference_id pode ser NULL para adições manuais (admin)
-- Tipos padronizados: leads_deduct, leads_rollback, leads_add, phone_deduct, phone_rollback, phone_add

-- Função para debitar créditos atomicamente
-- NOTA: reference_id é OBRIGATÓRIO - usado para rastreabilidade e rollback idempotente
CREATE OR REPLACE FUNCTION public.deduct_credits(
  p_workspace_id UUID,
  p_type TEXT,  -- 'leads' ou 'phone'
  p_amount INT,
  p_reference_id TEXT,  -- OBRIGATÓRIO para operações externas (movido antes do default)
  p_description TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
  history_type TEXT;
BEGIN
  -- Validar reference_id obrigatório para deduct
  IF p_reference_id IS NULL OR p_reference_id = '' THEN
    RAISE EXCEPTION 'reference_id is required for deduct operations (used for idempotent rollback)';
  END IF;

  -- Definir tipo padronizado para histórico
  IF p_type = 'leads' THEN
    history_type := 'leads_deduct';
    UPDATE public.credits
    SET leads_credits = leads_credits - p_amount, updated_at = now()
    WHERE workspace_id = p_workspace_id AND leads_credits >= p_amount;
  ELSIF p_type = 'phone' THEN
    history_type := 'phone_deduct';
    UPDATE public.credits
    SET phone_credits = phone_credits - p_amount, updated_at = now()
    WHERE workspace_id = p_workspace_id AND phone_credits >= p_amount;
  ELSE
    RAISE EXCEPTION 'Invalid credit type: %. Use "leads" or "phone"', p_type;
  END IF;

  -- Verificar se o update afetou alguma linha (saldo suficiente)
  IF NOT FOUND THEN
    RETURN FALSE;  -- Saldo insuficiente
  END IF;

  -- Registrar no histórico
  INSERT INTO public.credit_history (workspace_id, type, amount, description, reference_id)
  VALUES (p_workspace_id, history_type, -p_amount, p_description, p_reference_id);

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Função para adicionar/recreditar créditos (com idempotência para rollback)
-- NOTA: reference_id é OBRIGATÓRIO para rollback, OPCIONAL para adição manual (admin)
CREATE OR REPLACE FUNCTION public.add_credits(
  p_workspace_id UUID,
  p_type TEXT,  -- 'leads' ou 'phone'
  p_amount INT,
  p_description TEXT DEFAULT NULL,
  p_reference_id TEXT DEFAULT NULL  -- OBRIGATÓRIO para rollback, NULL para add manual
)
RETURNS BOOLEAN AS $$
DECLARE
  existing_rollback UUID;
  history_type TEXT;
BEGIN
  -- Definir tipo padronizado baseado na presença de reference_id
  IF p_reference_id IS NOT NULL AND p_reference_id != '' THEN
    -- É um rollback - verificar idempotência
    IF p_type = 'leads' THEN
      history_type := 'leads_rollback';
    ELSIF p_type = 'phone' THEN
      history_type := 'phone_rollback';
    ELSE
      RAISE EXCEPTION 'Invalid credit type: %. Use "leads" or "phone"', p_type;
    END IF;
    
    -- Verificar se rollback já foi executado (idempotência)
    SELECT id INTO existing_rollback FROM public.credit_history
    WHERE reference_id = p_reference_id AND type = history_type
    LIMIT 1;
    
    IF existing_rollback IS NOT NULL THEN
      RETURN TRUE;  -- Já foi revertido, retornar sucesso sem duplicar
    END IF;
  ELSE
    -- É uma adição manual (admin) - reference_id = NULL permitido
    IF p_type = 'leads' THEN
      history_type := 'leads_add';
    ELSIF p_type = 'phone' THEN
      history_type := 'phone_add';
    ELSE
      RAISE EXCEPTION 'Invalid credit type: %. Use "leads" or "phone"', p_type;
    END IF;
  END IF;

  -- Atualizar créditos
  IF p_type = 'leads' THEN
    UPDATE public.credits
    SET leads_credits = leads_credits + p_amount, updated_at = now()
    WHERE workspace_id = p_workspace_id;
  ELSIF p_type = 'phone' THEN
    UPDATE public.credits
    SET phone_credits = phone_credits + p_amount, updated_at = now()
    WHERE workspace_id = p_workspace_id;
  END IF;

  -- Registrar no histórico
  INSERT INTO public.credit_history (workspace_id, type, amount, description, reference_id)
  VALUES (p_workspace_id, history_type, p_amount, p_description, p_reference_id);

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =====================================================
-- FASE 1.2: UNIQUE Constraint para Idempotência
-- =====================================================
-- Previne duplicidade por concorrência em operações com reference_id
CREATE UNIQUE INDEX IF NOT EXISTS credit_history_reference_type_unique 
ON public.credit_history (reference_id, type) 
WHERE reference_id IS NOT NULL;

-- =====================================================
-- FASE 1.3: Tabela workspace_invites
-- =====================================================
CREATE TABLE IF NOT EXISTS public.workspace_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ
);

-- Índice para busca por token
CREATE INDEX IF NOT EXISTS workspace_invites_token_idx ON public.workspace_invites (token);

-- Índice para busca por email
CREATE INDEX IF NOT EXISTS workspace_invites_email_idx ON public.workspace_invites (email);

-- Habilitar RLS
ALTER TABLE public.workspace_invites ENABLE ROW LEVEL SECURITY;

-- Política: Admins podem gerenciar convites do seu workspace
CREATE POLICY "Admins can view workspace invites"
ON public.workspace_invites FOR SELECT
USING (is_workspace_admin(workspace_id));

CREATE POLICY "Admins can create workspace invites"
ON public.workspace_invites FOR INSERT
WITH CHECK (is_workspace_admin(workspace_id));

CREATE POLICY "Admins can update workspace invites"
ON public.workspace_invites FOR UPDATE
USING (is_workspace_admin(workspace_id));

CREATE POLICY "Admins can delete workspace invites"
ON public.workspace_invites FOR DELETE
USING (is_workspace_admin(workspace_id));

-- Comentários de documentação
COMMENT ON FUNCTION public.deduct_credits IS 'Debita créditos atomicamente. reference_id é OBRIGATÓRIO para rastreabilidade e rollback idempotente.';
COMMENT ON FUNCTION public.add_credits IS 'Adiciona/recredita créditos. reference_id OBRIGATÓRIO para rollback (idempotente), NULL permitido para adição manual (admin).';