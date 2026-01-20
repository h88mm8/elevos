-- 1. Atualizar CHECK constraint em credit_history para suportar todos os 6 tipos
ALTER TABLE public.credit_history DROP CONSTRAINT IF EXISTS credit_history_type_check;

ALTER TABLE public.credit_history ADD CONSTRAINT credit_history_type_check 
CHECK (type IN ('leads_deduct', 'leads_rollback', 'leads_add', 'phone_deduct', 'phone_rollback', 'phone_add'));

-- 2. Criar UNIQUE index para batch upsert de leads (apenas onde email não é null)
CREATE UNIQUE INDEX IF NOT EXISTS leads_workspace_email_unique 
ON public.leads (workspace_id, email) 
WHERE email IS NOT NULL;

-- 3. Criar índice único parcial em credit_history para idempotência do add_credits
CREATE UNIQUE INDEX IF NOT EXISTS credit_history_reference_type_unique 
ON public.credit_history (reference_id, type) 
WHERE reference_id IS NOT NULL;

-- 4. Refatorar add_credits RPC para usar ON CONFLICT DO NOTHING (idempotência)
CREATE OR REPLACE FUNCTION public.add_credits(
  p_workspace_id uuid, 
  p_type text, 
  p_amount integer, 
  p_description text DEFAULT NULL, 
  p_reference_id text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  history_type TEXT;
BEGIN
  -- Definir tipo padronizado baseado na presença de reference_id
  IF p_reference_id IS NOT NULL AND p_reference_id != '' THEN
    -- É um rollback
    IF p_type = 'leads' THEN
      history_type := 'leads_rollback';
    ELSIF p_type = 'phone' THEN
      history_type := 'phone_rollback';
    ELSE
      RAISE EXCEPTION 'Invalid credit type: %. Use "leads" or "phone"', p_type;
    END IF;
  ELSE
    -- É uma adição manual (admin)
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

  -- Registrar no histórico com ON CONFLICT DO NOTHING para idempotência
  INSERT INTO public.credit_history (workspace_id, type, amount, description, reference_id)
  VALUES (p_workspace_id, history_type, p_amount, p_description, p_reference_id)
  ON CONFLICT (reference_id, type) WHERE reference_id IS NOT NULL DO NOTHING;

  RETURN TRUE;
END;
$$;