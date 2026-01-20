-- Corrigir RLS da tabela accounts: remover policy FOR ALL e criar policies separadas

-- Remover policies existentes
DROP POLICY IF EXISTS "Members can view accounts" ON public.accounts;
DROP POLICY IF EXISTS "Admins can manage accounts" ON public.accounts;
DROP POLICY IF EXISTS "Admins can insert accounts" ON public.accounts;
DROP POLICY IF EXISTS "Admins can update accounts" ON public.accounts;
DROP POLICY IF EXISTS "Admins can delete accounts" ON public.accounts;

-- Criar policies separadas corretamente
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